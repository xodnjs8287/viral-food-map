from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from ai_reviewer import (
    AIReviewError,
    TrendReviewPayload,
    TrendReviewResult,
    review_trend_candidates,
)
from automation_budget import (
    get_automation_ai_budget_snapshot,
    reserve_automation_ai_call,
)
from config import settings
from crawlers.image_finder import find_food_image
from crawlers.instagram import get_hashtag_post_count
from crawlers.naver_datalab import calculate_acceleration, get_search_trend_insights
from crawlers.naver_search import get_blog_mention_count, search_blog_mentions
from crawlers.store_finder import find_stores_nationwide
from database import (
    delete_stores_by_trend_id,
    get_active_trends,
    get_all_keywords,
    get_keyword_aliases,
    get_stores_by_trend_id,
    get_trends_by_names,
    insert_stores,
    update_trend_status,
    upsert_keyword_aliases,
    upsert_trend,
)
from detector.alias_manager import (
    build_alias_lookup,
    build_alias_rows,
    build_alias_terms_by_canonical,
    clean_display_keyword,
    dedupe_terms,
    get_canonicalization_label,
    normalize_keyword_text,
    resolve_keyword_alias,
)
from detector.keyword_manager import get_all_seed_keywords, is_food_specific_keyword
from detector.store_updater import build_store_records

logger = logging.getLogger(__name__)

DEFAULT_CATEGORY = "기타"


def score_acceleration(acceleration: float) -> float:
    if acceleration >= settings.TREND_RISING_ACCELERATION_THRESHOLD:
        return 20
    if acceleration >= 50:
        return 15
    if acceleration >= settings.TREND_THRESHOLD:
        return 10
    return 0


def score_popularity(popularity: float) -> float:
    if popularity >= 140:
        return 25
    if popularity >= 100:
        return 20
    if popularity >= 70:
        return 15
    if popularity >= 40:
        return 10
    if popularity >= 20:
        return 5
    return 0


def score_rank(rank: int | None) -> float:
    if rank is None:
        return 0
    if rank <= 3:
        return 35
    if rank <= 5:
        return 30
    if rank <= 10:
        return 20
    if rank <= 20:
        return 10
    return 0


def classify_status(score: float, acceleration: float) -> str:
    if (
        acceleration >= settings.TREND_THRESHOLD
        and score >= settings.TREND_RISING_SCORE_THRESHOLD
    ):
        return "rising"
    if acceleration >= settings.TREND_RISING_ACCELERATION_THRESHOLD:
        return "rising"
    return "active"


def _build_search_volume_map(data_points: list[dict]) -> dict[str, float]:
    return {
        point.get("period", ""): point.get("ratio", 0)
        for point in data_points
        if point.get("period")
    }


def _parse_detected_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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
        "keywords": 0,
        "db_keywords": 0,
        "seed_keywords": 0,
        "candidates": 0,
        "rank_candidates": 0,
        "confirmed": 0,
        "stored_trends": 0,
        "stored_stores": 0,
        "confirmed_keywords": [],
        "deactivated_trends": [],
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


def _choose_category(
    keyword: str,
    keyword_metadata_by_name: dict[str, dict],
    existing_trend: dict | None,
) -> str:
    if keyword in keyword_metadata_by_name:
        return keyword_metadata_by_name[keyword].get("category") or DEFAULT_CATEGORY
    if existing_trend:
        return existing_trend.get("category") or DEFAULT_CATEGORY
    return DEFAULT_CATEGORY


def _build_keyword_metadata_by_name(
    db_keywords: list[dict],
    alias_lookup: dict[str, str],
    summary: dict,
    seen_canonicalizations: set[str],
) -> dict[str, dict]:
    keyword_metadata_by_name: dict[str, dict] = {}

    for item in [*get_all_seed_keywords(), *db_keywords]:
        raw_keyword = clean_display_keyword(item.get("keyword"))
        if not raw_keyword:
            continue

        canonical_keyword, matched = resolve_keyword_alias(raw_keyword, alias_lookup)
        if matched:
            _append_canonicalization(
                summary,
                seen_canonicalizations,
                raw_keyword,
                canonical_keyword,
            )

        merged = dict(keyword_metadata_by_name.get(canonical_keyword, {}))
        merged.update(item)
        merged["keyword"] = canonical_keyword
        keyword_metadata_by_name[canonical_keyword] = merged

    return keyword_metadata_by_name


def _deactivate_stale_trends(confirmed_keywords: list[str]) -> list[str]:
    cutoff = datetime.now(timezone.utc) - timedelta(
        hours=settings.ACTIVE_TREND_TTL_HOURS
    )
    confirmed_keyword_set = set(confirmed_keywords)
    deactivated_trends: list[str] = []

    for trend in get_active_trends() or []:
        trend_id = trend.get("id")
        keyword = trend.get("name")
        if not trend_id or not keyword or keyword in confirmed_keyword_set:
            continue

        detected_at = _parse_detected_at(trend.get("detected_at"))
        if detected_at and detected_at > cutoff:
            continue

        update_trend_status(trend_id, "inactive")
        deactivated_trends.append(keyword)

    return deactivated_trends


def _select_display_keyword(group_candidates: list[dict]) -> str:
    def sort_key(candidate: dict) -> tuple[float, float, float, float, int]:
        return (
            float(candidate.get("blog_count", 0)),
            float(candidate.get("ig_count") or 0),
            float(candidate.get("popularity", 0.0)),
            float(candidate.get("score", 0.0)),
            len(clean_display_keyword(candidate.get("keyword"))),
        )

    best_candidate = max(group_candidates, key=sort_key)
    return clean_display_keyword(best_candidate["keyword"])


def _select_primary_existing_trend(existing_trends: list[dict]) -> dict | None:
    if not existing_trends:
        return None

    def sort_key(trend: dict) -> tuple[float, float]:
        detected_at = _parse_detected_at(trend.get("detected_at"))
        detected_at_ts = detected_at.timestamp() if detected_at else 0.0
        return (float(trend.get("peak_score") or 0.0), detected_at_ts)

    return max(existing_trends, key=sort_key)


def _find_matching_existing_trends(
    active_trends: list[dict],
    *,
    search_terms: list[str],
    consumed_trend_ids: set[str],
    alias_lookup: dict[str, str],
) -> list[dict]:
    normalized_terms = {normalize_keyword_text(term) for term in search_terms if term}
    matches: list[dict] = []

    for trend in active_trends:
        trend_id = trend.get("id")
        if not trend_id or trend_id in consumed_trend_ids:
            continue

        trend_name = clean_display_keyword(trend.get("name"))
        trend_key = normalize_keyword_text(trend_name)
        resolved_name = alias_lookup.get(trend_key, trend_name)
        resolved_key = normalize_keyword_text(resolved_name)
        if trend_key in normalized_terms or resolved_key in normalized_terms:
            matches.append(trend)

    return matches


def _merge_duplicate_trend_stores(primary_trend_id: str, duplicate_trends: list[dict]) -> None:
    if not duplicate_trends:
        return

    primary_keys = {
        (store["name"], store["address"])
        for store in get_stores_by_trend_id(primary_trend_id)
    }
    records_to_insert: list[dict] = []

    for trend in duplicate_trends:
        duplicate_trend_id = trend.get("id")
        if not duplicate_trend_id or duplicate_trend_id == primary_trend_id:
            continue

        for store in get_stores_by_trend_id(duplicate_trend_id):
            key = (store["name"], store["address"])
            if key in primary_keys:
                continue
            primary_keys.add(key)
            records_to_insert.append(
                {
                    **store,
                    "id": str(uuid.uuid4()),
                    "trend_id": primary_trend_id,
                }
            )

        if records_to_insert:
            insert_stores(records_to_insert)
            records_to_insert = []
        delete_stores_by_trend_id(duplicate_trend_id)
        update_trend_status(duplicate_trend_id, "inactive")


def _collapse_cached_active_duplicates(
    active_trends: list[dict],
    alias_lookup: dict[str, str],
) -> None:
    grouped_trends: dict[str, list[dict]] = defaultdict(list)
    for trend in active_trends:
        trend_name = clean_display_keyword(trend.get("name"))
        if not trend_name:
            continue
        canonical_name = alias_lookup.get(normalize_keyword_text(trend_name), trend_name)
        grouped_trends[normalize_keyword_text(canonical_name)].append(trend)

    for trends in grouped_trends.values():
        if len(trends) < 2:
            continue
        primary_trend = _select_primary_existing_trend(trends)
        if primary_trend is None:
            continue
        duplicate_trends = [
            trend
            for trend in trends
            if trend.get("id") and trend.get("id") != primary_trend.get("id")
        ]
        _merge_duplicate_trend_stores(primary_trend["id"], duplicate_trends)


async def _build_review_payloads(candidates: list[dict]) -> list[TrendReviewPayload]:
    snippets_list = await asyncio.gather(
        *[
            search_blog_mentions(
                candidate["keyword"],
                display=settings.AI_REVIEW_MAX_EVIDENCE_SNIPPETS,
            )
            for candidate in candidates
        ]
    )

    return [
        TrendReviewPayload(
            keyword=candidate["keyword"],
            acceleration=candidate["acceleration"],
            search_volume_data=_build_search_volume_map(candidate["data_points"]),
            blog_count=candidate["blog_count"],
            ig_count=candidate["ig_count"],
            category_hint=candidate["category_hint"],
            evidence_snippets=snippets,
        )
        for candidate, snippets in zip(candidates, snippets_list)
    ]


async def detect_trends(trigger: str = "scheduler") -> dict:
    logger.info("=== trend detection started (%s) ===", trigger)

    summary = _build_summary()
    seen_canonicalizations: set[str] = set()
    alias_rows = get_keyword_aliases()
    alias_lookup = build_alias_lookup(alias_rows)
    alias_terms_by_canonical = build_alias_terms_by_canonical(alias_rows)
    active_trends = get_active_trends() or []
    _collapse_cached_active_duplicates(active_trends, alias_lookup)
    active_trends = get_active_trends() or []

    db_keywords = get_all_keywords() or []
    keyword_metadata_by_name = _build_keyword_metadata_by_name(
        db_keywords,
        alias_lookup,
        summary,
        seen_canonicalizations,
    )
    summary["db_keywords"] = len([item for item in db_keywords if item.get("keyword")])
    summary["seed_keywords"] = len(get_all_seed_keywords())
    summary["keywords"] = len(keyword_metadata_by_name)

    keywords = list(keyword_metadata_by_name)
    if not keywords:
        summary["deactivated_trends"] = _deactivate_stale_trends([])
        return summary

    trend_insights = await get_search_trend_insights(keywords)
    search_data = trend_insights["series"]
    popularity_scores = trend_insights["popularity_scores"]
    popularity_ranks = trend_insights["popularity_ranks"]

    candidates: list[dict] = []
    for keyword, data_points in search_data.items():
        acceleration = calculate_acceleration(data_points)
        popularity = float(popularity_scores.get(keyword, 0.0))
        rank = popularity_ranks.get(keyword)
        is_rank_candidate = (
            rank is not None and rank <= settings.TREND_TOP_RANK_CANDIDATE_MAX
        )
        if acceleration >= settings.TREND_THRESHOLD or is_rank_candidate:
            candidates.append(
                {
                    "keyword": keyword,
                    "acceleration": acceleration,
                    "data_points": data_points,
                    "popularity": popularity,
                    "rank": rank,
                }
            )
            if is_rank_candidate:
                summary["rank_candidates"] += 1

    summary["candidates"] = len(candidates)
    if not candidates:
        summary["deactivated_trends"] = _deactivate_stale_trends([])
        return summary

    candidate_existing_trends = {
        trend["name"]: trend
        for trend in get_trends_by_names([candidate["keyword"] for candidate in candidates])
        if trend.get("name")
    }

    eligible_candidates: list[dict] = []
    for candidate in candidates:
        keyword = candidate["keyword"]
        existing_trend = candidate_existing_trends.get(keyword)
        category_hint = _choose_category(
            keyword,
            keyword_metadata_by_name,
            existing_trend,
        )
        candidate["category_hint"] = category_hint

        if not is_food_specific_keyword(keyword):
            continue

        blog_count = await get_blog_mention_count(keyword)
        ig_count = await get_hashtag_post_count(keyword)
        score = score_rank(candidate.get("rank"))
        score += score_popularity(candidate.get("popularity", 0.0))
        score += score_acceleration(candidate["acceleration"])
        if blog_count > 1000:
            score += 30
        elif blog_count > 100:
            score += 15
        if ig_count is not None:
            if ig_count > 10000:
                score += 30
            elif ig_count > 1000:
                score += 15

        candidate["score"] = score
        candidate["blog_count"] = blog_count
        candidate["ig_count"] = ig_count

        if score < settings.TREND_SCORE_THRESHOLD:
            continue
        eligible_candidates.append(candidate)

    if not eligible_candidates:
        summary["deactivated_trends"] = _deactivate_stale_trends([])
        return summary

    review_results: dict[str, TrendReviewResult] = {}
    if settings.AI_REVIEW_ENABLED:
        reservation = reserve_automation_ai_call("trend_detection", trigger)
        summary["ai_calls_remaining"] = reservation.remaining_today
        if not reservation.allowed:
            summary["budget_exhausted"] = True
        else:
            review_payloads = await _build_review_payloads(eligible_candidates)
            try:
                review_results = await review_trend_candidates(review_payloads)
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
                logger.warning("AI trend batch review failed: %s", exc)

    confirmed_groups: dict[str, dict] = {}
    alias_rows_to_upsert: list[dict] = []

    for candidate in eligible_candidates:
        keyword = clean_display_keyword(candidate["keyword"])
        review = review_results.get(keyword)
        category = candidate["category_hint"]
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

        group = confirmed_groups.setdefault(
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

    if not confirmed_groups:
        summary["deactivated_trends"] = _deactivate_stale_trends([])
        return summary

    consumed_existing_ids: set[str] = set()
    confirmed_keywords: list[str] = []

    for group in confirmed_groups.values():
        group_candidates = group["candidates"]
        display_keyword = _select_display_keyword(group_candidates)
        confirmed_keywords.append(display_keyword)
        representative_candidate = max(
            group_candidates,
            key=lambda item: float(item.get("score", 0.0)),
        )
        category = representative_candidate.get("category") or DEFAULT_CATEGORY
        search_terms = dedupe_terms(
            [
                display_keyword,
                *[candidate["keyword"] for candidate in group_candidates],
                *group["ai_terms"],
                *alias_terms_by_canonical.get(display_keyword, []),
            ]
        )

        for term in search_terms:
            _append_canonicalization(
                summary,
                seen_canonicalizations,
                term,
                display_keyword,
            )

        matching_existing_trends = _find_matching_existing_trends(
            active_trends,
            search_terms=search_terms,
            consumed_trend_ids=consumed_existing_ids,
            alias_lookup=alias_lookup,
        )
        primary_existing_trend = _select_primary_existing_trend(matching_existing_trends)
        if primary_existing_trend:
            consumed_existing_ids.update(
                trend["id"] for trend in matching_existing_trends if trend.get("id")
            )

        duplicate_trends = [
            trend
            for trend in matching_existing_trends
            if primary_existing_trend
            and trend.get("id")
            and trend["id"] != primary_existing_trend["id"]
        ]

        alias_rows_to_upsert.extend(
            build_alias_rows(
                display_keyword,
                [
                    *search_terms,
                    *[trend.get("name", "") for trend in duplicate_trends],
                    primary_existing_trend.get("name", "") if primary_existing_trend else "",
                ],
                confidence=group["confidence"],
                source_job="trend_detection",
            )
        )

        if primary_existing_trend:
            _merge_duplicate_trend_stores(primary_existing_trend["id"], duplicate_trends)

        trend_id = (
            primary_existing_trend["id"]
            if primary_existing_trend and primary_existing_trend.get("id")
            else str(uuid.uuid4())
        )
        status = classify_status(
            representative_candidate["score"],
            representative_candidate["acceleration"],
        )
        trend_data = {
            "id": trend_id,
            "name": display_keyword,
            "category": category,
            "status": status,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "peak_score": representative_candidate["score"],
            "search_volume_data": _build_search_volume_map(
                representative_candidate["data_points"]
            ),
            "description": (
                primary_existing_trend.get("description")
                if primary_existing_trend
                else None
            ),
            "image_url": (
                primary_existing_trend.get("image_url")
                if primary_existing_trend
                else None
            ),
        }

        if not trend_data["image_url"]:
            image_url = await find_food_image(display_keyword, category=category)
            if image_url:
                trend_data["image_url"] = image_url

        upsert_trend(trend_data)
        summary["stored_trends"] += 1

        stores = await find_stores_nationwide(search_terms)
        if stores:
            store_records = build_store_records(trend_id, stores)
            insert_stores(store_records)
            summary["stored_stores"] += len(store_records)

    upsert_keyword_aliases(alias_rows_to_upsert)
    deduped_confirmed_keywords = dedupe_terms(confirmed_keywords)
    summary["confirmed"] = len(deduped_confirmed_keywords)
    summary["confirmed_keywords"] = deduped_confirmed_keywords
    summary["deactivated_trends"] = _deactivate_stale_trends(deduped_confirmed_keywords)

    logger.info(
        "=== trend detection finished: %s confirmed, %s stores ===",
        summary["confirmed"],
        summary["stored_stores"],
    )
    return summary
