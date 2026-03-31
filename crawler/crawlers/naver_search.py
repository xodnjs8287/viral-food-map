import logging
import re

import httpx

from config import settings

logger = logging.getLogger(__name__)

NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/blog"


def _build_headers() -> dict[str, str]:
    return {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


async def search_blog_mentions(keyword: str, display: int = 5) -> list[str]:
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                NAVER_SEARCH_URL,
                params={"query": keyword, "display": display, "sort": "date"},
                headers=_build_headers(),
                timeout=10,
            )
            response.raise_for_status()
    except Exception as exc:
        logger.error("Naver blog search failed for '%s': %s", keyword, exc)
        return []

    snippets: list[str] = []
    for item in response.json().get("items", []):
        title = _strip_html(item.get("title", ""))
        description = _strip_html(item.get("description", ""))
        snippet = " / ".join(part for part in (title, description) if part)
        if snippet:
            snippets.append(snippet[:220])
    return snippets


async def get_blog_mention_count(keyword: str) -> int:
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                NAVER_SEARCH_URL,
                params={"query": keyword, "display": 1, "sort": "date"},
                headers=_build_headers(),
                timeout=10,
            )
            response.raise_for_status()
    except Exception as exc:
        logger.error("Naver blog count failed for '%s': %s", keyword, exc)
        return 0

    return response.json().get("total", 0)
