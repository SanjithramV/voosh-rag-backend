# ingest/embed_server.py
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer("all-MiniLM-L6-v2")  # same model used for ingest

class TextReq(BaseModel):
    text: str

@app.post("/embed")
async def embed(req: TextReq):
    # returns vector as a list of floats
    vec = model.encode([req.text])[0].tolist()
    return {"embedding": vec}
