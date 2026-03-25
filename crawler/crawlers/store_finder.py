import asyncio
import httpx
from config import settings
import logging

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
    """카카오 로컬 API로 키워드 기반 판매처 검색"""
    headers = {"Authorization": f"KakaoAK {settings.KAKAO_REST_API_KEY}"}

    all_stores = []
    seen = set()
    try:
        async with httpx.AsyncClient() as client:
            for category_group_code in KAKAO_CATEGORY_GROUP_CODES:
                for p in range(1, 4):  # 최대 3페이지
                    params: dict = {
                        "query": keyword,
                        "category_group_code": category_group_code,
                        "page": p,
                        "size": size,
                    }
                    if x is not None and y is not None:
                        params["x"] = str(x)
                        params["y"] = str(y)
                        if radius:
                            params["radius"] = str(radius)
                            params["sort"] = "distance"

                    resp = await client.get(
                        KAKAO_SEARCH_URL,
                        params=params,
                        headers=headers,
                        timeout=10,
                    )
                    resp.raise_for_status()
                    data = resp.json()

                    for doc in data.get("documents", []):
                        store = {
                            "name": doc["place_name"],
                            "address": doc.get("road_address_name") or doc.get("address_name", ""),
                            "lat": float(doc["y"]),
                            "lng": float(doc["x"]),
                            "phone": doc.get("phone") or None,
                            "place_url": doc.get("place_url") or None,
                            "source": "kakao_api",
                            "verified": True,
                        }
                        key = (store["name"], store["address"])
                        if key in seen:
                            continue
                        seen.add(key)
                        all_stores.append(store)

                    if data.get("meta", {}).get("is_end", True):
                        break

    except Exception as e:
        logger.error(f"카카오 로컬 API 오류 ({keyword}): {e}")

    return all_stores


async def fetch_naver_rating(client: httpx.AsyncClient, store_name: str) -> float | None:
    """네이버 플레이스에서 가게 평점 조회"""
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }
    try:
        resp = await client.get(
            NAVER_LOCAL_URL,
            params={"query": store_name, "display": 1},
            headers=headers,
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])
        if not items:
            return None

        # 네이버 플레이스 페이지에서 평점 스크래핑
        link = items[0].get("link", "")
        if not link:
            return None

        page_resp = await client.get(link, timeout=5, follow_redirects=True)
        page_text = page_resp.text

        # 평점 패턴: "별점 4.52" 또는 "rating":"4.52"
        import re
        match = re.search(r'"rating"\s*:\s*"?(\d+\.?\d*)"?', page_text)
        if match:
            return round(float(match.group(1)), 1)

        match = re.search(r'별점\s*(\d+\.?\d*)', page_text)
        if match:
            return round(float(match.group(1)), 1)

    except Exception as e:
        logger.debug(f"네이버 평점 조회 실패 ({store_name}): {e}")

    return None


async def enrich_stores_with_ratings(stores: list[dict]) -> list[dict]:
    """판매처 목록에 네이버 평점 추가"""
    async with httpx.AsyncClient() as client:
        for store in stores:
            rating = await fetch_naver_rating(client, store["name"])
            store["rating"] = rating
            await asyncio.sleep(0.1)
    rated = sum(1 for s in stores if s.get("rating"))
    logger.info(f"평점 수집 완료: {rated}/{len(stores)}곳")
    return stores


async def find_stores_nationwide(keyword: str) -> list[dict]:
    """전국 주요 도시에서 판매처 검색 (중복 제거)"""
    all_stores = []
    seen = set()

    for city in MAJOR_CITIES:
        city_stores = await find_stores_kakao(
            keyword=keyword,
            x=city["x"],
            y=city["y"],
            radius=city["radius"],
        )
        for store in city_stores:
            key = (store["name"], store["address"])
            if key not in seen:
                seen.add(key)
                all_stores.append(store)

        await asyncio.sleep(0.1)  # rate limit 방지

    logger.info(f"'{keyword}' 전국 판매처 {len(all_stores)}곳 수집 ({len(MAJOR_CITIES)}개 도시)")

    # 네이버 평점 추가
    all_stores = await enrich_stores_with_ratings(all_stores)

    return all_stores
