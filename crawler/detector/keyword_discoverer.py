from __future__ import annotations

import asyncio
import logging
import re
from collections import Counter

import httpx
from kiwipiepy import Kiwi

from ai_reviewer import (
    AIReviewError,
    DiscoveryReviewPayload,
    TrendReviewResult,
    review_discovered_keywords,
)
from automation_budget import (
    get_automation_ai_budget_snapshot,
    reserve_automation_ai_call,
)
from config import settings
from database import get_all_keywords, get_keyword_aliases, insert_keywords, upsert_keyword_aliases
from detector.alias_manager import (
    build_alias_lookup,
    build_alias_rows,
    clean_display_keyword,
    dedupe_terms,
    get_canonicalization_label,
    normalize_keyword_text,
    resolve_keyword_alias,
)
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
DEFAULT_CATEGORY = "기타"

META_QUERIES = [
    "요즘 핫한 음식 트렌드",
    "SNS 인기 음식 2026",
    "요즘 뭐 먹어 추천",
    "최신 바이럴 음식",
    "요즘 뜨는 디저트",
    "요즘 유행하는 간식 길거리음식",
    "핫한 맛집 메뉴 신메뉴",
    "요즘 핫한 음료 카페 신메뉴",
    "요즘 뜨는 분식 길거리",
    "인스타 유행 먹거리",
]

CATEGORY_PATTERNS = {
    "디저트": re.compile(
        r"(케이크|마카롱|쿠키|크림|타르트|롤케이크|빙수|초콜릿|브라우니|푸딩)"
    ),
    "음료": re.compile(
        r"(라떼|에이드|주스|버블|보바|스무디|아이스티|밀크티|커피|티라미수라떼)"
    ),
    "식사": re.compile(
        r"(국밥|국수|라면|볶음|찜닭|파스타|초밥|샌드위치|마라탕|갈비|버거)"
    ),
    "간식": re.compile(
        r"(빵|붕어빵|호두과자|탕후루|츄러스|도넛|타코야키|쿠키슈|젤리)"
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

    nouns: list[str] = []
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

    return DEFAULT_CATEGORY


def collect_candidate_snippets(keyword: str, texts: list[str]) -> list[str]:
    snippets: list[str] = []
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


def _build_ai_detail_line(
    keyword: str,
    *,
    confidence: float | None,
    category: str,
    reason: str,
) -> str:
    confidence_text = f"{confidence:.2f}" if confidence is not None else "n/a"
    normalized_reason = " ".join(str(reason or "").split()) or "reason missing"
    return (
        f"{keyword} (confidence={confidence_text}, category={category}): "
        f"{normalized_reason[:160]}"
    )


def _is_ai_accept(review: TrendReviewResult) -> bool:
    return (
        review.verdict == "accept"
        and review.confidence >= settings.AI_REVIEW_MIN_CONFIDENCE
    )


def _build_summary() -> dict:
    _, remaining_today = get_automation_ai_budget_snapshot()
    return {
        "queries": len(META_QUERIES),
        "collected_posts": 0,
        "new_keywords": 0,
        "keywords": [],
        "ai_reviewed": 0,
        "ai_accepted": 0,
        "ai_rejected_details": [],
        "ai_review_details": [],
        "ai_fallback_details": [],
        "ai_calls_used": 0,
        "ai_calls_remaining": remaining_today,
        "alias_matches": 0,
        "canonicalized_keywords": [],
        "budget_exhausted": False,
    }


def _append_canonicalization(
    summary: dict,
    seen_labels: set[str],
    source_keyword: str,
    target_keyword: str,
) -> None:
    label = get_canonicalization_label(source_keyword, target_keyword)
    if not label or label in seen_labels:
        return
    seen_labels.add(label)
    summary["canonicalized_keywords"].append(label)
    summary["alias_matches"] += 1


def _select_display_keyword(group_candidates: list[dict]) -> str:
    def sort_key(candidate: dict) -> tuple[float, float, int]:
        return (
            float(candidate.get("frequency", 0)),
            float(candidate.get("food_score", 0)),
            len(clean_display_keyword(candidate.get("noun"))),
        )

    best_candidate = max(group_candidates, key=sort_key)
    return clean_display_keyword(best_candidate["noun"])


async def discover_keywords(trigger: str = "scheduler") -> dict:
    logger.info("keyword discovery started (%s)", trigger)
    summary = _build_summary()
    seen_canonicalizations: set[str] = set()
    alias_rows = get_keyword_aliases()
    alias_lookup = build_alias_lookup(alias_rows)

    all_texts: list[str] = []
    for query in META_QUERIES:
        items = await search_blogs(query)
        for item in items:
            text = strip_html(item.get("title", "")) + " " + strip_html(
                item.get("description", "")
            )
            all_texts.append(text)
        await asyncio.sleep(0.5)

    summary["collected_posts"] = len(all_texts)
    if not all_texts:
        return summary

    noun_counter = Counter()
    food_co_occurrence = Counter()
    for text in all_texts:
        nouns = extract_nouns(text)
        unique_nouns = {clean_display_keyword(noun) for noun in nouns if noun}
        noun_counter.update(unique_nouns)
        if unique_nouns & FOOD_CONTEXT_WORDS:
            for noun in unique_nouns:
                food_co_occurrence[noun] += 1

    existing_db_rows = get_all_keywords() or []
    existing_db = {
        clean_display_keyword(row["keyword"])
        for row in existing_db_rows
        if row.get("keyword")
    }
    existing_seed = {clean_display_keyword(keyword) for keyword in get_flat_keywords()}
    existing_keys = {
        normalize_keyword_text(keyword)
        for keyword in (*existing_db, *existing_seed)
        if keyword
    }
    existing_keys.update(normalize_keyword_text(word) for word in STOPWORDS if word)
    existing_keys.update(
        row.get("alias_normalized") or normalize_keyword_text(row.get("alias"))
        for row in alias_rows
        if row.get("alias") or row.get("alias_normalized")
    )

    candidates: list[dict] = []
    for noun, frequency in noun_counter.most_common():
        normalized_noun = normalize_keyword_text(noun)
        if not normalized_noun or normalized_noun in existing_keys:
            if normalized_noun in alias_lookup:
                _append_canonicalization(
                    summary,
                    seen_canonicalizations,
                    noun,
                    alias_lookup[normalized_noun],
                )
            continue
        if frequency < settings.DISCOVERY_MIN_FREQUENCY:
            break
        if not is_food_specific_keyword(noun):
            continue

        resolved_keyword, matched = resolve_keyword_alias(noun, alias_lookup)
        if matched:
            _append_canonicalization(
                summary,
                seen_canonicalizations,
                noun,
                resolved_keyword,
            )
            continue

        food_ratio = food_co_occurrence.get(noun, 0) / frequency if frequency > 0 else 0
        score = frequency * (1.5 if food_ratio > 0.3 else 1.0)
        candidates.append(
            {
                "noun": noun,
                "frequency": frequency,
                "food_score": round(score, 1),
                "food_ratio": round(food_ratio, 2),
                "category": classify_category(noun, noun_counter),
            }
        )

    candidates.sort(key=lambda item: item["food_score"], reverse=True)
    candidates = candidates[: settings.DISCOVERY_MAX_NEW_KEYWORDS]
    if not candidates:
        return summary

    review_results: dict[str, TrendReviewResult] = {}
    if settings.AI_REVIEW_ENABLED:
        reservation = reserve_automation_ai_call("keyword_discovery", trigger)
        summary["ai_calls_remaining"] = reservation.remaining_today
        if not reservation.allowed:
            summary["budget_exhausted"] = True
        else:
            review_payloads = [
                DiscoveryReviewPayload(
                    keyword=candidate["noun"],
                    frequency=candidate["frequency"],
                    food_ratio=candidate["food_ratio"],
                    category_hint=candidate["category"],
                    evidence_snippets=collect_candidate_snippets(
                        candidate["noun"],
                        all_texts,
                    ),
                )
                for candidate in candidates
            ]
            try:
                review_results = await review_discovered_keywords(review_payloads)
                summary["ai_calls_used"] = 1
                summary["ai_reviewed"] = len(review_payloads)
            except AIReviewError as exc:
                summary["ai_fallback_details"].append(
                    _build_ai_detail_line(
                        "batch",
                        confidence=None,
                        category=DEFAULT_CATEGORY,
                        reason=str(exc),
                    )
                )
                logger.warning("AI discovery batch review failed: %s", exc)

    grouped_candidates: dict[str, dict] = {}
    for candidate in candidates:
        keyword = clean_display_keyword(candidate["noun"])
        review = review_results.get(keyword)
        category = candidate["category"]
        cluster_key = normalize_keyword_text(keyword)
        ai_terms = [keyword]
        confidence: float | None = None

        if review is not None:
            if review.category != DEFAULT_CATEGORY or category == DEFAULT_CATEGORY:
                category = review.category

            if not _is_ai_accept(review):
                target_key = (
                    "ai_rejected_details"
                    if review.verdict == "reject"
                    else "ai_review_details"
                )
                summary[target_key].append(
                    _build_ai_detail_line(
                        keyword,
                        confidence=review.confidence,
                        category=category,
                        reason=review.reason,
                    )
                )
                continue

            summary["ai_accepted"] += 1
            confidence = review.confidence
            if review.canonical_keyword:
                ai_terms.append(review.canonical_keyword)
                cluster_key = normalize_keyword_text(review.canonical_keyword)

        group = grouped_candidates.setdefault(
            cluster_key,
            {
                "candidates": [],
                "ai_terms": [],
                "confidence": None,
            },
        )
        group["candidates"].append({**candidate, "category": category})
        group["ai_terms"].extend(ai_terms)
        if confidence is not None:
            group["confidence"] = max(group["confidence"] or 0.0, confidence)

    new_keywords: list[dict] = []
    alias_rows_to_upsert: list[dict] = []
    seen_inserted_keys: set[str] = set(existing_keys)

    for group in grouped_candidates.values():
        group_candidates = group["candidates"]
        display_keyword = _select_display_keyword(group_candidates)
        normalized_display = normalize_keyword_text(display_keyword)
        search_terms = dedupe_terms(
            [
                display_keyword,
                *[candidate["noun"] for candidate in group_candidates],
                *group["ai_terms"],
            ]
        )
        for term in search_terms:
            _append_canonicalization(
                summary,
                seen_canonicalizations,
                term,
                display_keyword,
            )

        alias_rows_to_upsert.extend(
            build_alias_rows(
                display_keyword,
                search_terms,
                confidence=group["confidence"],
                source_job="keyword_discovery",
            )
        )

        if not normalized_display or normalized_display in seen_inserted_keys:
            continue

        representative_candidate = max(
            group_candidates,
            key=lambda item: float(item.get("food_score", 0)),
        )
        new_keywords.append(
            {
                "keyword": display_keyword,
                "category": representative_candidate.get("category") or DEFAULT_CATEGORY,
                "is_active": True,
                "baseline_volume": 0,
            }
        )
        seen_inserted_keys.add(normalized_display)

    insert_keywords(new_keywords)
    upsert_keyword_aliases(alias_rows_to_upsert)
    summary["new_keywords"] = len(new_keywords)
    summary["keywords"] = [keyword["keyword"] for keyword in new_keywords]
    logger.info("keyword discovery finished with %s new keywords", len(new_keywords))
    return summary
