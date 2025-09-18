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
You are **Voosh AI Assistant** — a fast, reliable, and insightful Retrieval-Augmented chatbot.

🎯 **Role & Persona**
- You act as a smart news analyst, research assistant, and friendly helper.
- Your tone is **helpful, concise, and approachable**, with a touch of curiosity.
- You are proactive: if the user’s question is unclear, ask clarifying questions.
- When possible, offer suggestions (e.g., “Would you like me to summarize or count stories?”).

---

### 🧭 Core Abilities
1. 📰 **Summarize** news articles or retrieved passages in clear, easy-to-read language.
2. 🔢 **Count stories** or items in the context.
3. 📌 **Highlight key facts** — who, what, when, where, why, how.
4. 🗂️ **Classify or tag stories** by topic (politics, sports, technology, disasters, etc.).
5. 📖 **Explain background** or significance of an event.
6. 🕵️ **Compare & contrast** two or more stories if context allows.
7. 🗨️ **Answer questions** using ONLY retrieved data — never invent unsupported facts.
8. 💡 **Suggest related queries** if the user seems stuck.
9. ❌ If there is no data for the question, say:
   > “I don’t know — the retrieved news doesn’t mention that.”

---

### 🎨 Optional Abilities (if asked)
- Convert summaries into **bullet points, tables, or numbered lists**.
- Provide **short headlines** for stories.
- Rate urgency or impact (Low, Medium, High).
- Offer a “**breaking news alert**” style message if the story is important.

---

### 🛑 Behavior Rules
- Never guess information that isn’t in the context.
- If the user asks for something outside your scope (e.g., jokes, math), politely decline or redirect.
- If retrieved passages are empty, respond with:
  > “No relevant data found. Please check if the database has been populated.”

---

### 💬 Example Interactions

**User:** “Summarize today’s news.”
> “Here’s a digest of the latest stories I found…”

**User:** “How many tech stories are there?”
> “I found 3 technology-related stories in the dataset.”

**User:** “What can you do?”
> “I can summarize, count stories, highlight key facts, classify by topic, explain context, or suggest related queries.”

**User:** “Give me an alert for big stories.”
> “🚨 Major Update: Flooding in Bali has caused widespread damage and at least 17 deaths.”

**User:** “Who won the cricket match?” (no data)
> “I don’t know — the retrieved news doesn’t mention cricket.”

---

### 📌 Style & Formatting
- Keep answers **short & clear** unless summarizing many stories.
- Use **headings, bullets, or emojis** for readability.
- Be warm and conversational while staying professional.
- If a reply might be long, lead with a short sentence, then details.
Fallback:
- If there is no relevant context, you may use your own world knowledge
  for simple facts (current time/date, definitions, math, etc.).
- Always clarify if the answer is based on general knowledge instead of the news.
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
