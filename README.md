# RAG-Powered Chatbot Backend (Voosh Assignment)

Backend service for a RAG (Retrieval-Augmented Generation) powered chatbot that answers queries over news articles.

## 🚀 Features
- Ingests ~50 news articles into **Qdrant Cloud (via API)**
- Embeds text using **Jina embeddings**
- Retrieves top-k documents per query from Qdrant
- Calls **Google Gemini API** for final answers
- Session management with Redis (chat history per session)
- REST API endpoints for chat, history, reset, and new session
- Deployed on **Render**

## 🛠️ Tech Stack
- **Backend:** Node.js + Express
- **Embeddings:** Jina AI Embeddings
- **Vector DB:** Qdrant Cloud (API client)
- **LLM:** Google Gemini API
- **Cache & Sessions:** Redis (Render free tier)
- **Deployment:** Render.com

## 📂 Project Structure
backend/
├── server.js # Main server entrypoint
├── package.json
└── README.md

bash
Copy code

## ⚡ Setup (Local Development)
```bash
git clone <backend-repo-url>
cd backend
npm install
npm run dev
🔑 Environment Variables
Create a .env file:

# Redis
REDIS_URL=rediss://<your-render-redis-url>

# Qdrant
QDRANT_URL=https://<your-qdrant-instance>.api.qdrant.com
QDRANT_API_KEY=<your-qdrant-api-key>
QDRANT_COLLECTION=news_articles

# Jina embeddings
JINA_API_KEY=<your-jina-api-key>

# Gemini API
GEMINI_API_KEY=<your-gemini-api-key>

# Retrieval
TOP_K=4
📌 API Endpoints
Root
GET / → Health check (returns a running message)

Session
POST /session/new → Creates new session, returns sessionId

GET /session/:id/history → Fetches chat history for session

POST /session/:id/reset → Clears session history

Chat
POST /chat

Body:

json
Copy code
{
  "sessionId": "uuid-here",
  "message": "What is the latest news on AI?"
}
Response:

json
Copy code
{
  "reply": "Gemini generated answer...",
  "context": [
    { "score": 0.85, "text": "News snippet...", "title": "Title", "url": "https://..." }
  ]
}
🧪 Testing with Postman
Create new session
POST /session/new → returns { "sessionId": "<uuid>" }

Send chat query
POST /chat with body:

json
Copy code
{ "sessionId": "<uuid>", "message": "Summarize today's news" }
View history
GET /session/<uuid>/history

Reset session
POST /session/<uuid>/reset

Deployment

Hosted backend: https://voosh-rag-backend.onrender.com/

Connects to Qdrant Cloud & Redis
