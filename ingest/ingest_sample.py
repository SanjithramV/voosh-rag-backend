"""Sample ingest script to create demo embeddings and push to Qdrant.

This script:
- Loads sample articles from demo_data/articles.json
- Uses sentence-transformers (local model) to generate embeddings
- Connects to Qdrant (running on localhost:6333 by default) and upserts vectors

Before running:
- pip install -r requirements.txt
- Ensure Qdrant is running (see docker/docker-compose.yml)
""")

import os, json
from pathlib import Path
from tqdm import tqdm

def main():
    try:
        from sentence_transformers import SentenceTransformer
        from qdrant_client import QdrantClient
        from qdrant_client.http import models as rest
    except Exception as e:
        print("Missing packages. Please install requirements. Error:", e)
        return

    ROOT = Path(__file__).resolve().parents[1]
    demo = ROOT / "demo_data" / "articles.json"
    if not demo.exists():
        print("Demo data not found at", demo)
        return

    with open(demo, 'r', encoding='utf-8') as f:
        articles = json.load(f)

    texts = [a['text'] for a in articles]
    print("Loading sentence-transformers model (all-MiniLM-L6-v2 recommended)...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    embeddings = model.encode(texts, show_progress_bar=True, convert_to_numpy=True)

    qdrant_url = os.environ.get('QDRANT_URL','http://localhost:6333')
    client = QdrantClient(url=qdrant_url)
    collection_name = os.environ.get('QDRANT_COLLECTION','news_articles')

    # Prepare points
    points = []
    for i, art in enumerate(articles):
        points.append(rest.PointStruct(
            id=i+1,
            vector=embeddings[i].tolist(),
            payload={"title": art.get("title",""), "url": art.get("url",""), "text": art.get("text")[:500]}
        ))

    # Create collection if not exists
    try:
        client.recreate_collection(collection_name, vector_size=len(embeddings[0]))
    except Exception as e:
        print("Warning creating/recreating collection:", e)

    client.upsert(collection_name=collection_name, points=points)
    print("Upserted", len(points), "points to Qdrant collection", collection_name)

if __name__ == '__main__':
    main()
