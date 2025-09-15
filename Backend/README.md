# Backend (Express) for Voosh RAG Chatbot

## Overview
- Node.js + Express server with endpoints:
  - `POST /session/new` -> creates a sessionId
  - `GET /session/:id/history` -> fetch chat history for session
  - `POST /session/:id/reset` -> reset history
  - `POST /chat` -> send message: {sessionId, message} -> returns {reply, context}

## Setup
1. Copy `.env.example` to `.env` and fill the values:
   - REDIS_URL, QDRANT_URL, OPENAI_API_KEY or GEMINI_API_KEY

2. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

3. Start:
   ```bash
   npm run dev
   ```

## Vector DB & Retrieval
This backend includes placeholder functions. For full functionality:
- Run Qdrant (Docker compose included)
- Use the ingest scripts in `/ingest` to create embeddings and push vector points to Qdrant.
- Implement `retrieveFromVectorDB` in `server.js` to call Qdrant and return top-k passages.
