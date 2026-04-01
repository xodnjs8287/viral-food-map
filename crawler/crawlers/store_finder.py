from __future__ import annotations

import asyncio
import logging
import re

import httpx

from config import settings
from detector.alias_manager import dedupe_terms
from franchise_checker import is_franchise

logger = logging.getLogger(__name__)

KAKAO_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
NAVER_LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
KAKAO_CATEGORY_GROUP_CODES = ("FD6", "CE7")

MAJOR_CITIES = [
    {"name": "서울", "x": 126.978, "y": 37.5665, "radius": 20000},
    {"name": "부산", "x": 129.0756, "y": 35.1796, "radius": 15000},
    {"name": "대구", "x": 128.6014, "y": 35.8714, "radius": 12000},
    {"name": "인천", "x": 126.7052, "y": 37.4563, "radius": 15000},
    {"name": "광주", "x": 126.8526, "y": 35.1595, "radius": 10000},
    {"name": "대전", "x": 127.3845, "y": 36.3504, "radius": 10000},
    {"name": "울산", "x": 129.3114, "y": 35.5384, "radius": 10000},
    {"name": "세종", "x": 127.0090, "y": 36.4800, "radius": 10000},
    {"name": "수원", "x": 127.0286, "y": 37.2636, "radius": 10000},
    {"name": "제주", "x": 126.5312, "y": 33.4996, "radius": 15000},
]


async def find_stores_kakao(
    keyword: str,
    x: float | None = None,
    y: float | None = None,
    radius: int | None = None,
    size: int = 15,
) -> list[dict]:
    headers = {"Authorization": f"KakaoAK {settings.KAKAO_REST_API_KEY}"}

    all_stores: list[dict] = []
    seen: set[tuple[str, str]] = set()

    try:
        async with httpx.AsyncClient() as client:
            for category_group_code in KAKAO_CATEGORY_GROUP_CODES:
                for page in range(1, 4):
                    params: dict[str, str | int] = {
                        "query": keyword,
                        "category_group_code": category_group_code,
                        "page": page,
                        "size": size,
                    }
                    if x is not None and y is not None:
                        params["x"] = str(x)
                        params["y"] = str(y)
                        if radius:
                            params["radius"] = str(radius)
                            params["sort"] = "distance"

                    response = await client.get(
                        KAKAO_SEARCH_URL,
                        params=params,
                        headers=headers,
                        timeout=10,
                    )
                    response.raise_for_status()
                    data = response.json()

                    for document in data.get("documents", []):
                        place_name = document["place_name"]
                        store = {
                            "name": place_name,
                            "address": document.get("road_address_name")
                            or document.get("address_name", ""),
                            "lat": float(document["y"]),
                            "lng": float(document["x"]),
                            "phone": document.get("phone") or None,
                            "place_url": document.get("place_url") or None,
                            "source": "kakao_api",
                            "verified": True,
                            "is_franchise": is_franchise(place_name),
                        }
                        key = (store["name"], store["address"])
                        if key in seen:
                            continue
                        seen.add(key)
                        all_stores.append(store)

                    if data.get("meta", {}).get("is_end", True):
                        break
    except Exception as exc:
        logger.error("Kakao local search failed for '%s': %s", keyword, exc)

    return all_stores


async def fetch_naver_rating(
    client: httpx.AsyncClient,
    store_name: str,
) -> float | None:
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }

    try:
        response = await client.get(
            NAVER_LOCAL_URL,
            params={"query": store_name, "display": 1},
            headers=headers,
            timeout=5,
        )
        response.raise_for_status()
        items = response.json().get("items", [])
        if not items:
            return None

        link = items[0].get("link", "")
        if not link:
            return None

        page_response = await client.get(link, timeout=5, follow_redirects=True)
        page_text = page_response.text

        match = re.search(r'"rating"\s*:\s*"?(\d+\.?\d*)"?', page_text)
        if match:
            return round(float(match.group(1)), 1)

        match = re.search(r"별점\s*(\d+\.?\d*)", page_text)
        if match:
            return round(float(match.group(1)), 1)
    except Exception as exc:
        logger.debug("Naver rating fetch failed for '%s': %s", store_name, exc)

    return None


async def enrich_stores_with_ratings(stores: list[dict]) -> list[dict]:
    async with httpx.AsyncClient() as client:
        for store in stores:
            store["rating"] = await fetch_naver_rating(client, store["name"])
            await asyncio.sleep(0.1)

    rated_count = sum(1 for store in stores if store.get("rating") is not None)
    logger.info("Collected ratings for %s/%s stores", rated_count, len(stores))
    return stores


async def find_stores_nationwide(search_terms: list[str] | str) -> list[dict]:
    terms = (
        dedupe_terms(search_terms)
        if isinstance(search_terms, list)
        else dedupe_terms([search_terms])
    )
    all_stores: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for keyword in terms:
        for city in MAJOR_CITIES:
            city_stores = await find_stores_kakao(
                keyword=keyword,
                x=city["x"],
                y=city["y"],
                radius=city["radius"],
            )
            for store in city_stores:
                key = (store["name"], store["address"])
                if key in seen:
                    continue
                seen.add(key)
                all_stores.append(store)
            await asyncio.sleep(0.1)

    logger.info(
        "Collected %s stores for %s search terms across %s cities",
        len(all_stores),
        len(terms),
        len(MAJOR_CITIES),
    )
    return await enrich_stores_with_ratings(all_stores)
