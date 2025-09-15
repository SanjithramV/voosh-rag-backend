# RAG-Powered News Chatbot (Voosh Assignment) — Deliverable

This archive contains a **complete starter implementation** for the RAG-powered chatbot requested in the assignment PDF.  
It is designed so you can run the system locally and extend it. The project includes:

- `backend/` — Node.js (Express) REST API connecting to Redis for session history and to a Vector DB (Qdrant) for retrieval. Contains endpoints for chat, session history and reset.
- `frontend/` — React + SCSS chat UI that talks to the backend.
- `ingest/` — Python scripts to ingest news (RSS / sitemap) into the Vector DB and create embeddings (using Jina Embeddings or other embedding provider).
- `docker/` — `docker-compose.yml` to run Redis and Qdrant locally (optional but recommended).
- `demo_data/` — small sample news articles (JSON) for quick local testing without internet.
- `docs/` — instructions, how-to, and design notes to satisfy the assignment deliverables.

IMPORTANT: This is a *starter* full-stack repo that follows the assignment instructions. Some third-party services (Google Gemini API, Jina Embeddings, Qdrant) require API keys or Docker images to be installed locally. See the instructions below.

## Quick start (recommended)
1. Install Docker and Docker Compose.
2. From this folder run:
   ```bash
   cd docker
   docker compose up -d
   ```
   This starts Redis and Qdrant locally.

3. Backend:
   - Go to `backend/`. Copy `.env.example` to `.env` and fill values (REDIS_URL, QDRANT_URL, GEMINI_API_KEY or OPENAI_KEY).
   - Install dependencies: `npm install`
   - Start: `npm run dev` (uses nodemon) or `npm start`

4. Ingest sample data:
   - Ensure Python 3.9+ is installed.
   - Create virtualenv, install requirements in `ingest/requirements.txt`.
   - Run `python ingest/ingest_sample.py` to ingest the demo articles into Qdrant.

5. Frontend:
   - Go to `frontend/`
   - `npm install`
   - `npm start` to run React dev server (default: http://localhost:3000)

6. Use the chat UI to create a new session, send queries, and reset sessions. The backend will retrieve top-k passages, call the configured LLM (Gemini / OpenAI as configured) and stream/return the answer.

## Files that need user action (fill before running)
- `backend/.env` — add API keys and host URLs
- `docker/docker-compose.yml` — already configured to run qdrant & redis; adjust ports if needed.

## What is included
See `docs/DELIVERABLES.md` for how to produce the items required by the assignment (repos, demo video instructions, code walkthrough).

If you want, I can:
- Convert this into two separate GitHub repositories and push (I cannot push from this environment, but I will provide exact git commands).
- Produce the demo script for recording.
- Provide deployment steps for Render / Railway.

Enjoy — this zip contains everything necessary to satisfy the assignment; follow the README and docs to run locally.
