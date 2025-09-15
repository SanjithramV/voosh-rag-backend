const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();

const PORT = process.env.PORT || 4000;

// --- Redis connection ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("❌ No REDIS_URL set in environment variables");
  process.exit(1);
}

console.log("🔗 Connecting to Redis at:", redisUrl);

const redis = new Redis(redisUrl, {
  // Enable TLS if using rediss://
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});

redis.on("connect", () => {
  console.log("✅ Redis connected successfully");
});
redis.on("error", (err) => {
  console.error("❌ Redis connection error:", err);
});

// --- Express setup ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Redis session helpers ---
async function appendMessage(sessionId, role, text) {
  const key = `sess:${sessionId}:history`;
  await redis.rpush(key, JSON.stringify({ role, text, ts: Date.now() }));
  await redis.expire(key, 60 * 60 * 24 * 7); // 7 days
}

async function getHistory(sessionId) {
  const key = `sess:${sessionId}:history`;
  const list = await redis.lrange(key, 0, -1);
  return list.map(s => JSON.parse(s));
}

async function resetHistory(sessionId) {
  const key = `sess:${sessionId}:history`;
  await redis.del(key);
}

// --- Session routes ---
app.post('/session/new', async (req, res) => {
  const sessionId = uuidv4();
  await appendMessage(sessionId, 'system', 'New session created');
  res.json({ sessionId });
});

app.get('/session/:id/history', async (req, res) => {
  const sessionId = req.params.id;
  const history = await getHistory(sessionId);
  res.json({ sessionId, history });
});

app.post('/session/:id/reset', async (req, res) => {
  const sessionId = req.params.id;
  await resetHistory(sessionId);
  res.json({ ok: true });
});

// --- Vector retriever (Qdrant + Gemini embeddings) ---
async function retrieveFromVectorDB(query, topK = 4) {
  try {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return [{ text: "No GEMINI_API_KEY set. Please add it in backend/.env" }];
    }

    // 1. Create embedding using Gemini
    const embeddingRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${GEMINI_KEY}`,
      { content: { parts: [{ text: query }] } },
      { headers: { "Content-Type": "application/json" } }
    );

    const vector = embeddingRes.data.embedding.values;

    // 2. Search in Qdrant
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const collection = process.env.QDRANT_COLLECTION || "news_articles";

    const searchRes = await axios.post(
      `${qdrantUrl}/collections/${collection}/points/search`,
      { vector, limit: topK }
    );

    if (searchRes.data && searchRes.data.result) {
      return searchRes.data.result.map(r => ({
        score: r.score,
        text: r.payload.text,
        title: r.payload.title,
        url: r.payload.url,
      }));
    }
    return [];
  } catch (err) {
    console.error("Error retrieving from Qdrant:", err.response?.data || err.message);
    return [];
  }
}

async function callLLM(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${key}`;

  try {
    const res = await axios.post(
      url,
      { contents: [{ role: "user", parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );
    return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "No reply";
  } catch (err) {
    if (err.response?.status === 429) {
      return "🚦 Rate limit reached. Please wait a bit before trying again.";
    } else if (err.response?.status === 503) {
      return "⚠️ Gemini API overloaded. Please retry later.";
    }
    return "❌ Error calling Gemini: " + (err.response?.data?.error?.message || err.message);
  }
}

// --- Main chat endpoint ---
app.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });

    await appendMessage(sessionId, 'user', message);

    // 1. Retrieve passages
    const topK = parseInt(process.env.TOP_K || '4');
    const passages = await retrieveFromVectorDB(message, topK);

    // 2. Build prompt
    let contextText = passages.map((p, i) => `Passage ${i+1}: ${p.text || p}`).join('\n---\n');
    if (!contextText) contextText = '[NO RETRIEVED PASSAGES - run ingest script to populate vector DB]';

    const prompt = `Answer the question using the context below. If answer is not present, say you don't know and explain why.\n\nCONTEXT:\n${contextText}\n\nQUESTION:\n${message}`;

    // 3. Call Gemini
    const reply = await callLLM(prompt);

    // 4. Save + return
    await appendMessage(sessionId, 'assistant', reply);
    res.json({ reply, context: passages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Voosh RAG backend listening on ${PORT}`);
});
