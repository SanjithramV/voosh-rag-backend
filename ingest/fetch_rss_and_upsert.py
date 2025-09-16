# ingest/fetch_rss_and_upsert.py

import os, json, time
import feedparser
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")  # e.g. https://xxxxxx.cloud.qdrant.io
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")  # from Qdrant Cloud
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "news_articles")
JINA_API_KEY = os.getenv("JINA_API_KEY")

# RSS Feeds
FEEDS = [
    # 🌍 World & General News
    "http://feeds.reuters.com/reuters/topNews",
    "https://www.theguardian.com/world/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://www.npr.org/rss/rss.php?id=1004",   # NPR World
    "https://apnews.com/apf-topnews?format=rss", # Associated Press Top
    "https://www.economist.com/international/rss.xml",

    # 📰 Business & Economy
    "http://feeds.reuters.com/reuters/businessNews",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
    "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    "https://www.ft.com/?format=rss",  # Financial Times (general)

    # 💻 Technology
    "http://feeds.arstechnica.com/arstechnica/index",
    "https://www.wired.com/feed/rss",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.feedburner.com/TechCrunch/",
    "https://www.engadget.com/rss.xml",

    # 🌱 Science & Environment
    "https://www.scientificamerican.com/feed/rss/",
    "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",
    "https://www.nature.com/subjects/science.rss",
    "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",

    # 🏛️ Politics
    "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
    "https://feeds.bbci.co.uk/news/politics/rss.xml",
    "https://www.politico.com/rss/politics08.xml",
    
    # 🏟️ Sports (optional, if you want variety)
    "https://www.espn.com/espn/rss/news",
    "https://feeds.bbci.co.uk/sport/rss.xml?edition=uk",
]

def collect_articles(max_count=50):
    """Fetch articles from RSS feeds."""
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
                    "title": e.get("title", ""),
                    "url": e.get("link", ""),
                    "text": txt
                })
            time.sleep(0.3)
        except Exception as ex:
            print("Feed error", url, ex)
    return out[:max_count]

def embed_texts(texts):
    """Call Jina embedding API for a list of texts."""
    if not JINA_API_KEY:
        raise RuntimeError("⚠️ JINA_API_KEY not set in .env")

    url = "https://api.jina.ai/v1/embeddings"
    headers = {
        "Authorization": f"Bearer {JINA_API_KEY}",
        "Content-Type": "application/json"
    }

    resp = requests.post(url, headers=headers, json={
        "input": texts,
        "model": "jina-embeddings-v3"
    })

    if resp.status_code != 200:
        print("Error from Jina:", resp.text)
        raise RuntimeError("Jina API call failed")

    data = resp.json()
    return [item["embedding"] for item in data["data"]]

def main():
    articles = collect_articles()
    if not articles:
        print("No articles found. Check RSS URLs.")
        return

    print(f"Fetched {len(articles)} articles. Generating embeddings with Jina...")

    texts = [a["text"][:1000] for a in articles]
    embeddings = embed_texts(texts)

    # ✅ Connect to Qdrant (remote or local, depending on .env)
    client = QdrantClient(
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY,  # required for Qdrant Cloud
    )

    # Create/recreate collection
    dim = len(embeddings[0])
    client.recreate_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=dim, distance="Cosine")
    )

    points = []
    for i, a in enumerate(articles):
        payload = {"title": a["title"], "url": a["url"], "text": a["text"][:400]}
        points.append(PointStruct(id=i, vector=embeddings[i], payload=payload))

    client.upsert(collection_name=QDRANT_COLLECTION, points=points)
    print(f"✅ Upserted {len(points)} points to Qdrant collection {QDRANT_COLLECTION}")

    with open("articles_fetched.json", "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()

