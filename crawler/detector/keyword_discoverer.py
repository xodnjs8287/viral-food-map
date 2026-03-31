import asyncio
import logging
import re
from collections import Counter

import httpx
from kiwipiepy import Kiwi

from ai_reviewer import (
    AIReviewError,
    DiscoveryReviewPayload,
    review_discovered_keyword,
)
from config import settings
from database import get_all_keywords, insert_keywords
from detector.keyword_manager import (
    CATEGORY_SIGNALS,
    FOOD_CONTEXT_WORDS,
    STOPWORDS,
    get_flat_keywords,
    is_food_like_token,
    is_food_specific_keyword,
)

logger = logging.getLogger(__name__)

NAVER_BLOG_URL = "https://openapi.naver.com/v1/search/blog"

META_QUERIES = [
    "요즘 핫한 음식 트렌드",
    "SNS 인기 음식 2026",
    "요즘 뭐 먹지 추천",
    "틱톡 바이럴 음식",
    "요즘 뜨는 디저트",
    "요즘 유행하는 간식 거리음식",
    "핫한 맛집 메뉴 신메뉴",
    "요즘 핫한 음료 카페 신메뉴",
    "요즘 뜨는 분식 길거리",
    "인스타 유행 먹거리",
]

CATEGORY_PATTERNS = {
    "디저트": re.compile(
        r"(케이크|마카롱|쿠키|크림|타르트|롤|파이|빵|약과|탕후루|초콜릿|푸딩|카놀레|브라우니)"
    ),
    "음료": re.compile(
        r"(라떼|에이드|주스|버블|보바|스무디|아이스티|밀크티|커피|쉐이크)"
    ),
    "식사": re.compile(
        r"(덮밥|국수|라면|볶음|찌개|파스타|초밥|샌드위치|마라탕|마라샹궈|갈비|돈까스|버거)"
    ),
    "간식": re.compile(
        r"(호떡|붕어빵|계란빵|핫도그|츄러스|꽈배기|타코야키|도넛|떡볶이|김밥|핫바)"
    ),
}

_kiwi: Kiwi | None = None


def get_kiwi() -> Kiwi:
    global _kiwi
    if _kiwi is None:
        _kiwi = Kiwi()
    return _kiwi


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


async def search_blogs(query: str, display: int = 30) -> list[dict]:
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }

    async def _request() -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                NAVER_BLOG_URL,
                params={"query": query, "display": display, "sort": "date"},
                headers=headers,
                timeout=15,
            )
            response.raise_for_status()
            return response.json().get("items", [])

    try:
        return await _request()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 429:
            logger.error("Blog search failed for '%s': %s", query, exc)
            return []

        logger.warning("Blog search rate-limited for '%s', retrying once", query)
        await asyncio.sleep(2)
        try:
            return await _request()
        except Exception as retry_exc:
            logger.error("Blog search retry failed for '%s': %s", query, retry_exc)
            return []
    except Exception as exc:
        logger.error("Blog search failed for '%s': %s", query, exc)
        return []


def extract_nouns(text: str) -> list[str]:
    kiwi = get_kiwi()
    result = kiwi.analyze(text)
    tokens = result[0][0]

    nouns = []
    index = 0
    while index < len(tokens):
        token, tag, *_ = tokens[index]
        if tag not in {"NNG", "NNP"}:
            index += 1
            continue

        compound = token
        lookahead = index + 1
        while lookahead < len(tokens) and lookahead - index < 3:
            next_token, next_tag, *_ = tokens[lookahead]
            if next_tag not in {"NNG", "NNP"}:
                break
            compound += next_token
            lookahead += 1

        if lookahead > index + 1 and 3 <= len(compound) <= 12:
            nouns.append(compound)
            index = lookahead
            continue

        if 2 <= len(token) <= 10 and is_food_like_token(token, tag):
            nouns.append(token)
        index += 1

    return nouns


def classify_category(noun: str, context_nouns: Counter) -> str:
    scores = {
        category: sum(context_nouns.get(signal, 0) for signal in signals)
        for category, signals in CATEGORY_SIGNALS.items()
    }
    best_category = max(scores, key=scores.get)
    if scores[best_category] > 0:
        return best_category

    for category, pattern in CATEGORY_PATTERNS.items():
        if pattern.search(noun):
            return category

    return "기타"


def collect_candidate_snippets(keyword: str, texts: list[str]) -> list[str]:
    snippets = []
    for text in texts:
        if keyword not in text:
            continue

        snippet = " ".join(text.split())
        if not snippet:
            continue

        snippets.append(snippet[:220])
        if len(snippets) >= settings.AI_REVIEW_MAX_EVIDENCE_SNIPPETS:
            break

    return snippets


async def discover_keywords() -> dict:
    logger.info("Keyword discovery started")
    summary = {
        "queries": len(META_QUERIES),
        "collected_posts": 0,
        "new_keywords": 0,
        "keywords": [],
        "ai_reviewed": 0,
        "ai_skipped_keywords": [],
        "ai_fallback_keywords": [],
    }

    all_texts = []
    for query in META_QUERIES:
        items = await search_blogs(query)
        for item in items:
            text = strip_html(item.get("title", "")) + " " + strip_html(
                item.get("description", "")
            )
            all_texts.append(text)
        logger.info("Collected %s blog posts for '%s'", len(items), query)
        await asyncio.sleep(0.5)

    summary["collected_posts"] = len(all_texts)
    logger.info("Collected %s blog texts for keyword discovery", len(all_texts))

    if not all_texts:
        logger.warning("No blog texts were collected for keyword discovery")
        return summary

    noun_counter = Counter()
    food_co_occurrence = Counter()
    for text in all_texts:
        nouns = extract_nouns(text)
        unique_nouns = set(nouns)
        noun_counter.update(unique_nouns)

        if unique_nouns & FOOD_CONTEXT_WORDS:
            for noun in unique_nouns:
                food_co_occurrence[noun] += 1

    existing_db = {kw["keyword"] for kw in (get_all_keywords() or [])}
    existing_seed = set(get_flat_keywords())
    existing = existing_db | existing_seed | STOPWORDS

    candidates = []
    for noun, frequency in noun_counter.most_common():
        if noun in existing:
            continue
        if frequency < settings.DISCOVERY_MIN_FREQUENCY:
            break
        if not is_food_specific_keyword(noun):
            continue

        food_ratio = food_co_occurrence.get(noun, 0) / frequency if frequency > 0 else 0
        score = frequency * (1.5 if food_ratio > 0.3 else 1.0)
        candidates.append({
            "noun": noun,
            "frequency": frequency,
            "food_score": round(score, 1),
            "food_ratio": round(food_ratio, 2),
        })

    candidates.sort(key=lambda item: item["food_score"], reverse=True)
    candidates = candidates[: settings.DISCOVERY_MAX_NEW_KEYWORDS]

    if not candidates:
        logger.info("No new keyword candidates passed rule-based discovery")
        return summary

    new_keywords = []
    seen_keywords = set()
    review_limit = min(settings.AI_DISCOVERY_REVIEW_MAX_CANDIDATES, len(candidates))

    for index, candidate in enumerate(candidates):
        original_keyword = candidate["noun"]
        resolved_keyword = original_keyword
        category = classify_category(original_keyword, noun_counter)

        if settings.AI_REVIEW_ENABLED and index < review_limit:
            try:
                review = await review_discovered_keyword(
                    DiscoveryReviewPayload(
                        keyword=original_keyword,
                        frequency=candidate["frequency"],
                        food_ratio=candidate["food_ratio"],
                        category_hint=category,
                        evidence_snippets=collect_candidate_snippets(
                            original_keyword,
                            all_texts,
                        ),
                    )
                )
                summary["ai_reviewed"] += 1

                if (
                    review.verdict != "accept"
                    or review.confidence < settings.AI_REVIEW_MIN_CONFIDENCE
                ):
                    summary["ai_skipped_keywords"].append(original_keyword)
                    logger.info(
                        "AI skipped discovered keyword '%s': %s",
                        original_keyword,
                        review.reason,
                    )
                    continue

                resolved_keyword = review.canonical_keyword or original_keyword
                if review.category != "기타" or category == "기타":
                    category = review.category
            except AIReviewError as exc:
                summary["ai_fallback_keywords"].append(original_keyword)
                logger.warning(
                    "AI review failed for discovered keyword '%s', using rules: %s",
                    original_keyword,
                    exc,
                )

        if resolved_keyword in existing or resolved_keyword in seen_keywords:
            logger.info("Skipping duplicate discovered keyword '%s'", resolved_keyword)
            continue

        new_keywords.append({
            "keyword": resolved_keyword,
            "category": category,
            "is_active": True,
            "baseline_volume": 0,
        })
        seen_keywords.add(resolved_keyword)
        logger.info(
            "Discovered keyword '%s' (freq=%s, score=%s, category=%s)",
            resolved_keyword,
            candidate["frequency"],
            candidate["food_score"],
            category,
        )

    insert_keywords(new_keywords)
    summary["new_keywords"] = len(new_keywords)
    summary["keywords"] = [keyword["keyword"] for keyword in new_keywords]
    logger.info("Stored %s discovered keywords", len(new_keywords))
    return summary
