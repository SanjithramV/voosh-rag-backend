const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const Redis = require("ioredis");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const { QdrantClient } = require("@qdrant/js-client-rest");
require("dotenv").config();

const PORT = process.env.PORT || 4000;

// --- Redis connection ---
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("❌ No REDIS_URL set in environment variables");
  process.exit(1);
}
console.log("🔗 Connecting to Redis at:", redisUrl);

const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});
redis.on("connect", () => console.log("✅ Redis connected successfully"));
redis.on("error", (err) => console.error("❌ Redis connection error:", err));

// --- Qdrant connection ---
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "news_articles";

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
  return list.map((s) => JSON.parse(s));
}
async function resetHistory(sessionId) {
  const key = `sess:${sessionId}:history`;
  await redis.del(key);
}

// --- Session routes ---
app.post("/session/new", async (req, res) => {
  const sessionId = uuidv4();
  await appendMessage(sessionId, "system", "New session created");
  res.json({ sessionId });
});
app.get("/session/:id/history", async (req, res) => {
  const history = await getHistory(req.params.id);
  res.json({ sessionId: req.params.id, history });
});
app.post("/session/:id/reset", async (req, res) => {
  await resetHistory(req.params.id);
  res.json({ ok: true });
});

// --- Jina embeddings ---
async function createEmbeddingJina(text) {
  try {
    const JINA_KEY = process.env.JINA_API_KEY;
    if (!JINA_KEY) throw new Error("JINA_API_KEY not set");

    const response = await axios.post(
      "https://api.jina.ai/v1/embeddings",
      { model: "jina-embeddings-v3", input: text },
      {
        headers: {
          Authorization: `Bearer ${JINA_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.data[0].embedding;
  } catch (err) {
    console.error("❌ Error calling Jina embeddings:", err.response?.data || err.message);
    return null;
  }
}

// --- Vector retriever (Qdrant + Jina embeddings) ---
async function retrieveFromVectorDB(query, topK = 4) {
  try {
    const vector = await createEmbeddingJina(query);
    if (!vector) return [];

    const results = await qdrant.search(QDRANT_COLLECTION, {
      vector,
      limit: topK,
    });

    return results.map((r) => ({
      score: r.score,
      text: r.payload?.text,
      title: r.payload?.title,
      url: r.payload?.url,
    }));
  } catch (err) {
    console.error("❌ Error retrieving from Qdrant:", err.response?.data || err.message);
    return [];
  }
}

// --- System prompt for Gemini ---
const SYSTEM_PROMPT = `
You are **Voosh AI Assistant**, a Retrieval-Augmented Generation (RAG) bot.

Your primary goal is to help users interact with news data that has been ingested into Qdrant.
You combine retrieved passages with reasoning to give clear, actionable answers.

---

### Capabilities
- 📰 Summarize one or more news articles in plain language.
- 🔢 Count or list the number of stories found in the retrieved context.
- 📌 Provide key facts: who, what, when, where, why, and how.
- 📖 Explain the background or significance of an event.
- 💬 Answer direct questions using only the retrieved passages.
- 🧹 Start a new session or reset an existing one on request.
- ❌ If a question cannot be answered with the data, politely say:
  “I don’t know — this isn’t covered in the retrieved information.”

---

### Style Guidelines
- Respond **clearly and concisely**.
- Prefer bullet points for lists.
- If context is missing, tell the user that no passages were found and remind them that data may need to be ingested.
- Never invent facts not supported by the retrieved context.
- When the user asks “what can you do”, always list the abilities above.

---

### Example Interactions
**User:** “Summarize today’s stories.”  
**Assistant:** “Here’s a quick summary of the retrieved news…”

**User:** “How many stories are there?”  
**Assistant:** “There are 4 stories in the current dataset.”

**User:** “What can you do?”  
**Assistant:** “I can summarize articles, count stories, explain context, answer questions, or tell you if I don’t know.”

**User:** “Who won the football match?” (no data about sports)  
**Assistant:** “I don’t know — the retrieved news doesn’t mention football results.”

---
`;


// --- Gemini API for response ---
async function callLLM(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "❌ GEMINI_API_KEY not set in backend env";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${key}`;

  try {
    const res = await axios.post(
      url,
      { contents: [{ role: "user", parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );
    return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "No reply";
  } catch (err) {
    if (err.response?.status === 429) return "🚦 Rate limit reached. Please wait.";
    if (err.response?.status === 503) return "⚠️ Gemini API overloaded. Please retry later.";
    return "❌ Error calling Gemini: " + (err.response?.data?.error?.message || err.message);
  }
}

// --- Main chat endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message)
      return res.status(400).json({ error: "sessionId and message required" });

    await appendMessage(sessionId, "user", message);

    // 1. Retrieve passages
    const topK = parseInt(process.env.TOP_K || "4");
    const passages = await retrieveFromVectorDB(message, topK);

    // 2. Build prompt with system instructions
    let contextText = passages.map((p, i) => `Passage ${i + 1}: ${p.text || p}`).join("\n---\n");
    if (!contextText)
      contextText = "[NO RETRIEVED PASSAGES - run ingest script to populate Qdrant Cloud]";

    const fullPrompt = `${SYSTEM_PROMPT}\n\nContext:\n${contextText}\n\nUser question:\n${message}`;

    // 3. Call Gemini
    const reply = await callLLM(fullPrompt);

    // 4. Save + return
    await appendMessage(sessionId, "assistant", reply);
    res.json({ reply, context: passages });
  } catch (err) {
    console.error("❌ /chat error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`🚀 Voosh RAG backend listening on ${PORT}`));
