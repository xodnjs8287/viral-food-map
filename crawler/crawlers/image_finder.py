import httpx
from config import settings
import logging

logger = logging.getLogger(__name__)

NAVER_IMAGE_URL = "https://openapi.naver.com/v1/search/image"

CATEGORY_SUFFIX = {
    "디저트": "디저트 음식",
    "음료": "음료 드링크",
    "한식": "한식 음식",
    "양식": "양식 음식",
    "분식": "분식 음식",
    "간식": "간식 음식",
}
DEFAULT_SUFFIX = "음식 맛집"


async def _score_image(client: httpx.AsyncClient, item: dict) -> float:
    """이미지 후보 점수 계산. 높을수록 좋음."""
    score = 0.0
    link = item.get("link", "")

    # 블로그 이미지 선호
    if "blog" in link or "post" in link:
        score += 3.0
    # 쇼핑/썸네일 이미지 기피
    if "shop" in link or "shopping" in link:
        score -= 5.0
    if "thumb" in link or "thumbnail" in link:
        score -= 2.0

    # HEAD 요청으로 이미지 유효성 확인
    try:
        resp = await client.head(link, timeout=5, follow_redirects=True)
        content_length = int(resp.headers.get("content-length", 0))
        content_type = resp.headers.get("content-type", "")

        if "image" not in content_type:
            score -= 10.0
        if content_length > 50_000:
            score += 2.0
        if content_length < 10_000:
            score -= 3.0
    except Exception:
        score -= 1.0

    return score


async def find_food_image(keyword: str, category: str | None = None) -> str | None:
    """네이버 이미지 검색 API로 음식 대표 이미지 URL 조회 (품질 검증 포함)"""
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }

    suffix = CATEGORY_SUFFIX.get(category, DEFAULT_SUFFIX) if category else DEFAULT_SUFFIX

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                NAVER_IMAGE_URL,
                params={
                    "query": f"{keyword} {suffix}",
                    "display": 10,
                    "sort": "sim",
                    "filter": "large",
                },
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()

            items = data.get("items", [])
            if not items:
                return None

            # 각 후보 이미지 점수 계산
            scored = []
            for item in items:
                s = await _score_image(client, item)
                scored.append((s, item.get("link", "")))

            scored.sort(key=lambda x: x[0], reverse=True)

            # 양수 점수 중 최고 반환, 없으면 첫 번째 fallback
            for s, link in scored:
                if s > 0 and link:
                    return link

            return scored[0][1] if scored and scored[0][1] else None

    except Exception as e:
        logger.error(f"네이버 이미지 검색 오류 ({keyword}): {e}")

    return None
