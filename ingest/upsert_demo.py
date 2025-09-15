# ingest/upsert_demo.py
import json
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams

QDRANT_URL = "http://localhost:6333"
COLLECTION = "news_articles"

def main():
    model = SentenceTransformer("all-MiniLM-L6-v2")  # small & fast
    client = QdrantClient(url=QDRANT_URL)

    with open("../demo_data/articles.json", "r", encoding="utf-8") as f:
        articles = json.load(f)

    texts = [a.get("text", "")[:1000] for a in articles]
    embeddings = model.encode(texts, show_progress_bar=True)

    # recreate collection
    client.recreate_collection(
        collection_name=COLLECTION,
        vectors_config=VectorParams(size=len(embeddings[0]), distance="Cosine"),
    )

    points = []
    for i, art in enumerate(articles):
        payload = {
            "title": art.get("title", ""),
            "url": art.get("url", ""),
            "snippet": art.get("text", "")[:200]
        }
        points.append(PointStruct(id=i, vector=embeddings[i].tolist(), payload=payload))

    client.upsert(collection_name=COLLECTION, points=points)
    print(f"Upserted {len(points)} points into Qdrant collection '{COLLECTION}'")

if __name__ == "__main__":
    main()
