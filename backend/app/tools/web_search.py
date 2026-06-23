import logging
import requests
from app.config import settings

logger = logging.getLogger(__name__)

def web_search(query: str, max_results: int = 5, freshness: str = "noLimit") -> list[dict]:
    """使用博查开放平台进行联网搜索"""
    if not settings.BOCHA_API_KEY:
        logger.warning("BOCHA_API_KEY not set, web search disabled.")
        return []

    headers = {
        "Authorization": f"Bearer {settings.BOCHA_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "query": query,
        "freshness": freshness,
        "summary": True,
        "count": max_results
    }
    
    try:
        resp = requests.post(
            settings.BOCHA_ENDPOINT,
            headers=headers,
            json=payload,
            timeout=15
        )
        resp.raise_for_status()
        data = resp.json()
        
        if data.get("code") != 200:
            logger.error(f"Bocha API error: {data.get('msg')}")
            return []
        
        results = []
        web_pages = data.get("data", {}).get("webPages", {})
        for item in web_pages.get("value", []):
            results.append({
                "title": item.get("name", ""),
                "url": item.get("url", ""),
                "content": item.get("snippet", ""),
                "site_name": item.get("siteName", ""),
                "date": item.get("dateLastCrawled", ""),
                "score": 1.0
            })
        
        logger.info(f"Bocha search returned {len(results)} results for '{query}'")
        return results
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Bocha search request failed: {e}")
        return []
    except Exception as e:
        logger.error(f"Bocha search error: {e}")
        return []