RAG-Powered News Chatbot – Backend

This is the backend service for the Voosh Full Stack Developer assignment.
It powers a Retrieval-Augmented Generation (RAG) chatbot that answers questions over a news corpus.

RAG Pipeline: Retrieve top-k passages, call Gemini	Vector embeddings stored in Qdrant, retrieved by query, LLM call to Gemini/OpenAI
Backend: Node.js (Express) REST API	Implemented in server.js
Session Storage: In-memory DB (Redis)	Redis stores per-session chat history, TTL configurable
Session APIs: New session, history, reset	Endpoints: /session/new, /session/:id/history, /session/:id/reset
Chat API: Query + RAG	Endpoint: /chat
Optional DB for transcripts	Redis used for transcripts; easy to extend to Postgres/MySQL
Caching & TTL	Redis keys auto-expire (default 7 days)
Tech Stack	Node.js, Express, Redis, Qdrant, Axios, Gemini/OpenAI
Deployment	Ready for Render deployment
🏗 Architecture
User -> Frontend (React)
       -> Backend (Node/Express)
             -> Redis (chat history)
             -> Qdrant (vector store)
             -> Gemini/OpenAI (LLM)

⚙️ Setup Instructions
1. Environment Variables

Create a .env in backend/:

PORT=4000

# Redis (for session history)
REDIS_URL=redis://<your_redis_instance>:6379

# Qdrant (for vector retrieval)
QDRANT_URL=http://<your_qdrant_instance>:6333
QDRANT_COLLECTION=news_articles

# LLM Keys (use at least one)
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key


Redis keys expire after 7 days to satisfy caching and TTL requirements.

2. Local Development
cd backend
npm install
npm run dev   # Development with nodemon
# or
npm start     # Production mode


API runs at http://localhost:4000.

3. Endpoints
Method	Endpoint	Purpose
POST	/session/new	Create a new chat session (returns sessionId)
GET	/session/:id/history	Fetch full chat history for a session
POST	/session/:id/reset	Clear session history
POST	/chat	RAG query: retrieve top-k from Qdrant and call LLM
4. Deployment (Render Example)

Push to GitHub
Ensure .gitignore excludes:

node_modules/
.env
venv/


Create a Web Service on Render

Root directory: backend

Build command: npm install

Start command: npm start

Environment: Node 18+

Add Environment Variables:

PORT=4000
REDIS_URL=...
QDRANT_URL=...
QDRANT_COLLECTION=news_articles
GEMINI_API_KEY=...
OPENAI_API_KEY=...


Use a managed Redis (Upstash/Render Redis) and Qdrant Cloud instance.

🧩 Tech Stack

Backend: Node.js (Express)

Vector DB: Qdrant (cloud or Docker)

Embeddings: Sentence Transformers / Jina (ingestion handled separately)

LLM: Google Gemini API (preferred) or OpenAI as fallback

Caching & Sessions: Redis (7-day TTL)

🔑 Deliverables Checklist (Backend)

 Node.js REST API

 Session management with Redis

 Chat endpoint retrieving from Qdrant & calling Gemini/OpenAI

 Environment variable driven configuration

 Ready for cloud deployment (Render)
