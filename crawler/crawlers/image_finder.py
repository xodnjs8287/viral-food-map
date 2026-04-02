from __future__ import annotations

import asyncio
import html
import logging
import re
from urllib.parse import parse_qs, unquote, urlsplit

import httpx

from config import settings

logger = logging.getLogger(__name__)

NAVER_IMAGE_URL = "https://openapi.naver.com/v1/search/image"
MIN_ACCEPTABLE_SCORE = 7.0
EXISTING_IMAGE_MARGIN = 2.0
HTML_TAG_RE = re.compile(r"<[^>]+>")
NORMALIZE_RE = re.compile(r"[^0-9A-Za-z\uAC00-\uD7A3]+")

CATEGORY_SUFFIX = {
    "디저트": "디저트 사진",
    "음료": "음료 사진",
    "주류": "주류 사진",
    "식사": "음식 사진",
    "분식": "분식 사진",
    "간식": "간식 사진",
    "한식": "한식 음식 사진",
    "중식": "중식 음식 사진",
    "일식": "일식 음식 사진",
    "양식": "양식 음식 사진",
}
DEFAULT_SUFFIX = "음식 사진"
PHOTO_HINT_TERMS = (
    "맛집",
    "후기",
    "리뷰",
    "먹방",
    "메뉴",
    "레시피",
    "카페",
    "사진",
)
IRRELEVANT_TERMS = (
    "구매",
    "판매",
    "배송",
    "택배",
    "쇼핑",
    "스토어",
    "상품",
    "최저가",
    "로고",
    "배너",
    "포스터",
    "이벤트",
    "광고",
    "캐릭터",
    "굿즈",
    "스티커",
    "이모티콘",
    "일러스트",
    "도안",
    "png",
    "svg",
    "gif",
)
HOST_PENALTIES = {
    "images.pexels.com": 8.0,
    "images.unsplash.com": 6.0,
    "cdn.crowdpic.net": 8.0,
    "i.pinimg.com": 7.0,
    "s.pinimg.com": 7.0,
    "media.istockphoto.com": 8.0,
    "images.ctfassets.net": 4.0,
    "image.musinsa.com": 8.0,
    "yt3.googleusercontent.com": 10.0,
    "yt3.ggpht.com": 10.0,
}


def _strip_html(value: str | None) -> str:
    return html.unescape(HTML_TAG_RE.sub(" ", str(value or ""))).strip()


def _normalize_text(value: str | None) -> str:
    return NORMALIZE_RE.sub("", _strip_html(value).lower())


def _normalize_url(value: str | None) -> str:
    if not value:
        return ""
    parsed = urlsplit(value)
    path = unquote(parsed.path or "").rstrip("/")
    return f"{parsed.netloc.lower()}{path}"


def _keyword_terms(keyword: str) -> list[str]:
    terms: list[str] = []

    normalized_keyword = _normalize_text(keyword)
    if normalized_keyword:
        terms.append(normalized_keyword)

    for raw_term in _strip_html(keyword).split():
        normalized_term = _normalize_text(raw_term)
        if len(normalized_term) < 2 or normalized_term in terms:
            continue
        terms.append(normalized_term)

    return terms


def _build_query(keyword: str, category: str | None) -> str:
    suffix = CATEGORY_SUFFIX.get(category or "", DEFAULT_SUFFIX)
    return f"{keyword} {suffix}".strip()


def _build_queries(keyword: str, category: str | None) -> list[str]:
    secondary_query = (
        f"{keyword} 카페 메뉴 사진"
        if category in {"음료", "주류"}
        else f"{keyword} 맛집 후기 사진"
    )
    return [
        _build_query(keyword, category),
        secondary_query,
    ]


def should_refresh_existing_image(existing_image_url: str | None) -> bool:
    if not existing_image_url:
        return True

    parsed = urlsplit(existing_image_url)
    hostname = parsed.netloc.lower()
    if hostname in HOST_PENALTIES:
        return True

    if parse_qs(parsed.query).get("mark"):
        return True

    path = (parsed.path or "").lower()
    return path.endswith(".svg") or path.endswith(".gif")


async def _score_image(
    client: httpx.AsyncClient,
    item: dict,
    *,
    keyword: str,
    category: str | None,
) -> float:
    score = 0.0
    link = item.get("link", "")
    parsed_link = urlsplit(link)
    hostname = parsed_link.netloc.lower()
    title_text = _strip_html(item.get("title"))
    title_key = _normalize_text(title_text)
    link_key = _normalize_text(unquote(link))
    thumbnail_key = _normalize_text(unquote(item.get("thumbnail")))
    combined_key = " ".join(filter(None, [title_key, link_key, thumbnail_key]))

    matched_terms = 0
    keyword_terms = _keyword_terms(keyword)
    if keyword_terms:
        primary_keyword = keyword_terms[0]
        if primary_keyword and primary_keyword in title_key:
            score += 12.0
            matched_terms += 1
        elif primary_keyword and primary_keyword in combined_key:
            score += 7.0
            matched_terms += 1

        for term in keyword_terms[1:]:
            if term in title_key:
                score += 4.0
                matched_terms += 1
            elif term in combined_key:
                score += 2.0
                matched_terms += 1

    if matched_terms == 0:
        score -= 8.0

    category_hint = CATEGORY_SUFFIX.get(category or "")
    category_key = _normalize_text(category_hint)
    if category_key and category_key in combined_key:
        score += 1.0

    for term in PHOTO_HINT_TERMS:
        normalized_term = _normalize_text(term)
        if normalized_term and normalized_term in title_key:
            score += 1.0

    for term in IRRELEVANT_TERMS:
        normalized_term = _normalize_text(term)
        if not normalized_term:
            continue
        if normalized_term in title_key:
            score -= 6.0
        elif normalized_term in combined_key:
            score -= 3.0

    if "blog" in link or "post" in link:
        score += 3.0
    if "shop" in link or "shopping" in link:
        score -= 5.0
    if "thumb" in link or "thumbnail" in link:
        score -= 2.0

    score -= HOST_PENALTIES.get(hostname, 0.0)

    if parse_qs(parsed_link.query).get("mark"):
        score -= 5.0

    image_path = (parsed_link.path or "").lower()
    if image_path.endswith(".svg") or image_path.endswith(".gif"):
        score -= 6.0

    width = int(item.get("sizewidth") or 0)
    height = int(item.get("sizeheight") or 0)
    if width >= 400 and height >= 400:
        score += 1.0
    elif width and height and (width < 200 or height < 200):
        score -= 2.0

    try:
        resp = await client.head(link, timeout=5, follow_redirects=True)
        content_length = int(resp.headers.get("content-length", 0))
        content_type = resp.headers.get("content-type", "")

        if "image" not in content_type:
            score -= 10.0
        if content_length > 50_000:
            score += 2.0
        if 0 < content_length < 10_000:
            score -= 3.0
    except Exception:
        score -= 1.0

    return score


async def find_food_image(
    keyword: str,
    category: str | None = None,
    existing_image_url: str | None = None,
) -> str | None:
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }

    try:
        async with httpx.AsyncClient() as client:
            seen_links: set[str] = set()
            items: list[dict] = []

            for query in _build_queries(keyword, category):
                resp = await client.get(
                    NAVER_IMAGE_URL,
                    params={
                        "query": query,
                        "display": 10,
                        "sort": "sim",
                        "filter": "large",
                    },
                    headers=headers,
                    timeout=10,
                )
                resp.raise_for_status()
                for item in resp.json().get("items", []):
                    link = item.get("link")
                    if not link or link in seen_links:
                        continue
                    seen_links.add(link)
                    items.append(item)

            if not items:
                return existing_image_url

            scores = await asyncio.gather(
                *[
                    _score_image(
                        client,
                        item,
                        keyword=keyword,
                        category=category,
                    )
                    for item in items
                ]
            )
            scored = [
                (score, item.get("link", ""))
                for score, item in zip(scores, items)
                if item.get("link")
            ]
            if not scored:
                return existing_image_url

            scored.sort(key=lambda candidate: candidate[0], reverse=True)
            best_score, best_link = scored[0]

            if existing_image_url:
                existing_key = _normalize_url(existing_image_url)
                for score, link in scored:
                    if _normalize_url(link) != existing_key:
                        continue
                    if score >= max(
                        MIN_ACCEPTABLE_SCORE - 1.0,
                        best_score - EXISTING_IMAGE_MARGIN,
                    ):
                        return existing_image_url
                    break

            if best_score >= MIN_ACCEPTABLE_SCORE:
                return best_link

            return existing_image_url
    except Exception as exc:
        logger.error("naver image search failed for %s: %s", keyword, exc)
        return existing_image_url
