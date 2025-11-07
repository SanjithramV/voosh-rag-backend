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
app.get("/", (req, res) => {
  res.send("🚀 RAG Chatbot Backend is running successfully!");
});
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
You are **Voosh AI Assistant** — a fast, reliable, and friendly news and research chatbot.

🎯 **Role**
- Act as a smart news analyst and helpful assistant.
- Be clear, concise, and approachable.
- Ask clarifying questions if the query is unclear.
- Offer suggestions when helpful (e.g., "Would you like me to summarize or count stories?").

---

### 🧭 **Core Abilities**
1. Summarize news articles or retrieved passages.
2. Count the number of stories or items.
3. Highlight key facts — who, what, when, where, why, how.
4. Classify stories by topic (politics, sports, tech, etc.).
5. Explain background or importance of events.
6. Compare or contrast stories.
7. Answer using only retrieved data (no guessing).
8. Suggest related queries.
9. If no data is found, say:
   > “I don’t know — the retrieved news doesn’t mention that.”

---

### 💬 **If No Data**
> “No relevant data found. Please check if the database has been populated.”

---

### ✨ **Style**
- Keep answers short, clear, and well-formatted.
- Use bullets or emojis for readability.
- Stay warm, factual, and professional.
- For long answers, start with a short summary.
- If the answer uses general knowledge (not from data), clarify it.

`;


// --- Gemini API for response ---
async function callLLM(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "❌ GEMINI_API_KEY not set in backend env";

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;


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
// --- Main chat endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "Missing sessionId or message" });
    }

    // 1️⃣ Store user message in Redis
    await appendMessage(sessionId, "user", message);

    // 2️⃣ Retrieve relevant docs from Qdrant
    const passages = await retrieveFromVectorDB(message, 4);

    // 3️⃣ Build prompt (system + context + user)
    let contextText = passages
      .map((p, i) => `Passage ${i + 1}: ${p.text || "[no text]"}`)
      .join("\n---\n");

    if (!contextText) {
      contextText = "[NO RETRIEVED PASSAGES - database might be empty]";
    }

    const fullPrompt = `${SYSTEM_PROMPT}

Context:
${contextText}

User Question:
${message}`;

    // 4️⃣ Call Gemini
    const reply = await callLLM(fullPrompt);

    // 5️⃣ Store assistant reply in Redis
    await appendMessage(sessionId, "assistant", reply);

    // 6️⃣ Return response
    res.json({ reply, context: passages });
  } catch (err) {
    console.error("❌ /chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



app.listen(PORT, () => console.log(`🚀 Voosh RAG backend listening on ${PORT}`));
