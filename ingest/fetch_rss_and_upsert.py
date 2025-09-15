# ingest/fetch_rss_and_upsert.py
import json, time
import feedparser
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams

QDRANT_URL = "http://localhost:6333"
COLLECTION = "news_articles"

# Add as many RSS feeds as you like
FEEDS = [
    "http://feeds.reuters.com/reuters/topNews",
    "https://www.theguardian.com/world/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://www.bbc.co.uk/news/10628494",  # BBC has pages, but keep list here
    # add more RSS URLs
]

def collect_articles(max_count=60):
    out = []
    for url in FEEDS:
        try:
            d = feedparser.parse(url)
            for e in d.entries:
                if len(out) >= max_count:
                    break
                txt = (e.get("summary") or e.get("description") or "") 
                out.append({
                    "id": e.get("id", e.get("link")),
                    "title": e.get("title",""),
                    "url": e.get("link",""),
                    "text": txt
                })
            time.sleep(0.3)
        except Exception as ex:
            print("Feed error", url, ex)
    return out[:max_count]

def main():
    articles = collect_articles(50)
    if len(articles) == 0:
        print("No articles found. Check RSS feed URLs.")
        return

    print("Fetched", len(articles), "articles. Creating embeddings...")
    model = SentenceTransformer("all-MiniLM-L6-v2")   # 384-dim
    texts = [a["text"][:1000] for a in articles]
    embeddings = model.encode(texts, show_progress_bar=True)

    client = QdrantClient(url=QDRANT_URL)

    # create/recreate collection with appropriate vector size
    client.recreate_collection(collection_name=COLLECTION,
                               vectors_config=VectorParams(size=len(embeddings[0]), distance="Cosine"))

    points = []
    for i, a in enumerate(articles):
        payload = {"title": a["title"], "url": a["url"], "text": a["text"][:400]}
        points.append(PointStruct(id=i, vector=embeddings[i].tolist(), payload=payload))

    client.upsert(collection_name=COLLECTION, points=points)
    print("Upserted", len(points), "points to Qdrant collection", COLLECTION)

    with open("articles_fetched.json","w",encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
