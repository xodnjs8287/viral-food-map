from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from ai_reviewer import (
    AIReviewError,
    TrendDescriptionPayload,
    TrendReviewPayload,
    TrendReviewResult,
    generate_trend_descriptions,
    review_trend_candidates,
)
from automation_budget import (
    get_automation_ai_budget_snapshot,
    reserve_automation_ai_call,
)
from notifications import send_discord_message
from config import settings
from crawlers.image_finder import find_food_image
from crawlers.instagram import get_hashtag_post_count
from crawlers.naver_datalab import calculate_acceleration, get_search_trend_insights
from crawlers.naver_search import (
    BlogSearchInsights,
    get_blog_search_insights,
    search_blog_mentions,
)
from crawlers.store_finder import find_stores_nationwide
from database import (
    delete_stores_by_trend_id,
    get_ai_review_latest_statuses,
    get_active_trends,
    get_all_keywords,
    get_keyword_aliases,
    get_stores_by_trend_id,
    get_trends_by_names,
    insert_stores,
    insert_trend_review,
    update_trend_status,
    update_trend_verdict_counts,
    upsert_ai_review_queue_entry,
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
from detector.keyword_manager import (
    get_all_seed_keywords,
    is_food_specific_keyword,
    requires_trend_revalidation,
)
from detector.store_updater import build_store_records

logger = logging.getLogger(__name__)

DEFAULT_CATEGORY = "기타"


def score_acceleration(acceleration: float) -> float:
    if acceleration >= settings.TREND_RISING_ACCELERATION_THRESHOLD:
        return 30
    if acceleration >= 50:
        return 22
    if acceleration >= settings.TREND_THRESHOLD:
        return 15
    return 0


def score_novelty_lift(novelty_lift: float | None) -> float:
    if novelty_lift is None:
        return 0
    if novelty_lift >= 100:
        return 25
    if novelty_lift >= 50:
        return 20
    if novelty_lift >= 20:
        return 15
    if novelty_lift >= 10:
        return 10
    if novelty_lift >= 5:
        return 5
    return 0


def score_popularity(popularity: float) -> float:
    if popularity >= 140:
        return 10
    if popularity >= 100:
        return 8
    if popularity >= 70:
        return 6
    if popularity >= 40:
        return 4
    if popularity >= 20:
        return 2
    return 0


def score_rank(rank: int | None) -> float:
    if rank is None:
        return 0
    if rank <= 3:
        return 7
    if rank <= 5:
        return 5
    if rank <= 10:
        return 3
    if rank <= 20:
        return 1
    return 0


def score_blog_freshness(blog_insights: BlogSearchInsights) -> float:
    if (
        blog_insights.recent_count >= 10
        and blog_insights.recent_ratio >= 0.8
    ):
        return 20
    if (
        blog_insights.recent_count >= 6
        and blog_insights.recent_ratio >= 0.6
    ):
        return 10
    if (
        blog_insights.recent_count >= 3
        and blog_insights.recent_ratio >= 0.4
    ):
        return 5
    return 0


def classify_status(
    score: float,
    acceleration: float,
    *,
    existing_status: str | None = None,
    consecutive_accepts: int = 0,
) -> str:
    if existing_status is None:
        return "watchlist"

    if existing_status == "watchlist":
        if consecutive_accepts >= settings.TREND_WATCHLIST_PROMOTION_ACCEPTS:
            if (
                acceleration >= settings.TREND_THRESHOLD
                and score >= settings.TREND_RISING_SCORE_THRESHOLD
            ):
                return "rising"
            return "active"
        return "watchlist"

    if (
        acceleration >= settings.TREND_THRESHOLD
        and score >= settings.TREND_RISING_SCORE_THRESHOLD
    ):
        return "rising"
    if acceleration >= settings.TREND_RISING_ACCELERATION_THRESHOLD:
        return "rising"
    return "active"


def calculate_recent_lift(
    data_points: list[dict],
    *,
    recent_days: int,
    baseline_days: int,
) -> float | None:
    required_points = recent_days + baseline_days
    if len(data_points) < required_points:
        return None

    recent_points = data_points[-recent_days:]
    baseline_points = data_points[-required_points:-recent_days]
    if not recent_points or not baseline_points:
        return None

    recent_average = sum(point.get("ratio", 0) for point in recent_points) / len(recent_points)
    baseline_average = sum(point.get("ratio", 0) for point in baseline_points) / len(
        baseline_points
    )

    if baseline_average <= 0:
        return 100.0 if recent_average > 0 else 0.0

    return round(((recent_average - baseline_average) / baseline_average) * 100, 2)


def _is_reference_keyword(keyword: str) -> bool:
    return normalize_keyword_text(keyword) == normalize_keyword_text(
        settings.TREND_REFERENCE_KEYWORD
    )


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
    grounding_queries: list[str] | None = None,
    grounding_sources: list[str] | None = None,
) -> str:
    confidence_text = f"{confidence:.2f}" if confidence is not None else "n/a"
    normalized_reason = " ".join(str(reason or "").split()) or "reason missing"
    detail = (
        f"{keyword} (confidence={confidence_text}, category={category}): "
        f"{normalized_reason[:160]}"
    )
    preview_parts: list[str] = []
    if grounding_queries:
        preview_parts.append(
            "queries="
            + ", ".join(" ".join(query.split())[:40] for query in grounding_queries[:2])
        )
    if grounding_sources:
        preview_parts.append(
            "sources="
            + ", ".join(
                " ".join(source.split())[:60] for source in grounding_sources[:2]
            )
        )
    if preview_parts:
        detail = f"{detail} | {' | '.join(preview_parts)}"
    return detail[:320]


def _build_review_queue_payload(
    candidate: dict,
    *,
    category: str,
    review: TrendReviewResult,
    existing_trend: dict | None,
) -> dict:
    return {
        "category_hint": candidate.get("category_hint"),
        "category": category,
        "canonical_keyword": review.canonical_keyword,
        "score": candidate.get("score"),
        "acceleration": candidate.get("acceleration"),
        "novelty_lift": candidate.get("novelty_lift"),
        "score_breakdown": candidate.get("score_breakdown"),
        "blog_count": candidate.get("blog_count"),
        "blog_recent_count": candidate.get("blog_recent_count"),
        "blog_recent_ratio": candidate.get("blog_recent_ratio"),
        "ig_count": candidate.get("ig_count"),
        "popularity": candidate.get("popularity"),
        "rank": candidate.get("rank"),
        "existing_status": existing_trend.get("status") if existing_trend else None,
        "grounding_queries": review.grounding_queries,
        "grounding_sources": review.grounding_sources,
    }


def _summarize_ai_grounding(
    review_results: dict[str, TrendReviewResult],
) -> tuple[str | None, str | None, list[str], list[str]]:
    if not review_results:
        return None, None, [], []

    for review in review_results.values():
        if review.grounding_used or review.grounding_queries or review.grounding_sources:
            return (
                "used",
                review.grounding_detail,
                review.grounding_queries[:3],
                review.grounding_sources[:3],
            )

    detail = next(
        (review.grounding_detail for review in review_results.values() if review.grounding_detail),
        None,
    )
    return "not_used", detail, [], []


def _is_ai_accept(review: TrendReviewResult) -> bool:
    return (
        review.verdict == "accept"
        and review.confidence >= settings.AI_REVIEW_MIN_CONFIDENCE
    )


def _collect_description_snippets(
    group_candidates: list[dict],
    review_payloads_by_keyword: dict[str, TrendReviewPayload],
) -> list[str]:
    snippets: list[str] = []
    seen: set[str] = set()

    sorted_candidates = sorted(
        group_candidates,
        key=lambda candidate: float(candidate.get("score", 0.0)),
        reverse=True,
    )
    for candidate in sorted_candidates:
        keyword = clean_display_keyword(candidate.get("keyword"))
        if not keyword:
            continue

        payload = review_payloads_by_keyword.get(keyword)
        if payload is None:
            continue

        for raw_snippet in payload.evidence_snippets:
            snippet = " ".join(str(raw_snippet or "").split())
            if not snippet or snippet in seen:
                continue
            seen.add(snippet)
            snippets.append(snippet[:220])
            if len(snippets) >= settings.AI_REVIEW_MAX_EVIDENCE_SNIPPETS:
                return snippets

    return snippets


def _build_summary() -> dict:
    _, remaining_today = get_automation_ai_budget_snapshot()
    return {
        "keywords": 0,
        "db_keywords": 0,
        "seed_keywords": 0,
        "candidates": 0,
        "confirmed": 0,
        "stored_trends": 0,
        "stored_stores": 0,
        "generated_descriptions": 0,
        "confirmed_keywords": [],
        "new_confirmed_keywords": [],
        "deactivated_trends": [],
        "watchlist_count": 0,
        "promoted_from_watchlist": [],
        "ai_reviewed": 0,
        "ai_accepted": 0,
        "ai_reviews_persisted": 0,
        "ai_reviews_queued": 0,
        "ai_grounding_status": None,
        "ai_grounding_detail": None,
        "ai_grounding_queries": [],
        "ai_grounding_sources": [],
        "ai_rejected_details": [],
        "ai_review_details": [],
        "ai_fallback_details": [],
        "ai_calls_used": 0,
        "ai_calls_remaining": remaining_today,
        "alias_matches": 0,
        "canonicalized_keywords": [],
        "budget_exhausted": False,
        "skipped_reference_keywords": [],
        "filtered_stale_keywords": [],
        "filtered_generic_keywords": [],
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


def _deactivate_invalid_active_trends(active_trends: list[dict]) -> list[str]:
    deactivated_trends: list[str] = []

    for trend in active_trends:
        trend_id = trend.get("id")
        keyword = clean_display_keyword(trend.get("name"))
        if not trend_id or not keyword:
            continue
        if is_food_specific_keyword(keyword):
            continue

        update_trend_status(trend_id, "inactive")
        deactivated_trends.append(keyword)

    return deactivated_trends


def _deactivate_rejected_active_trends(rejected_keywords: list[str]) -> list[str]:
    rejected_keys = {
        normalize_keyword_text(keyword)
        for keyword in rejected_keywords
        if clean_display_keyword(keyword)
    }
    if not rejected_keys:
        return []

    deactivated_trends: list[str] = []
    for trend in get_active_trends() or []:
        trend_id = trend.get("id")
        keyword = clean_display_keyword(trend.get("name"))
        if not trend_id or not keyword:
            continue
        if normalize_keyword_text(keyword) not in rejected_keys:
            continue

        update_trend_status(trend_id, "inactive")
        deactivated_trends.append(keyword)

    return dedupe_terms(deactivated_trends)


def _merge_deactivated_trends(*trend_groups: list[str]) -> list[str]:
    return dedupe_terms(
        [
            keyword
            for group in trend_groups
            for keyword in group
            if clean_display_keyword(keyword)
        ]
    )


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


def _should_refresh_image(
    existing_trend: dict | None,
    display_keyword: str,
) -> bool:
    if not existing_trend:
        return True

    if not existing_trend.get("image_url"):
        return True

    existing_name = clean_display_keyword(existing_trend.get("name"))
    return normalize_keyword_text(existing_name) != normalize_keyword_text(
        display_keyword
    )


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


def _dedupe_existing_trends(*trend_groups: list[dict]) -> list[dict]:
    deduped: dict[str, dict] = {}

    for trends in trend_groups:
        for trend in trends:
            trend_id = trend.get("id")
            if trend_id:
                deduped[trend_id] = trend
                continue

            trend_name = clean_display_keyword(trend.get("name"))
            if not trend_name:
                continue
            deduped[f"name:{normalize_keyword_text(trend_name)}"] = trend

    return list(deduped.values())


def _find_persisted_matching_trends(
    *,
    search_terms: list[str],
    consumed_trend_ids: set[str],
    alias_lookup: dict[str, str],
) -> list[dict]:
    persisted_trends = get_trends_by_names(search_terms)
    if not persisted_trends:
        return []

    return _find_matching_existing_trends(
        persisted_trends,
        search_terms=search_terms,
        consumed_trend_ids=consumed_trend_ids,
        alias_lookup=alias_lookup,
    )


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
    invalid_active_trends = _deactivate_invalid_active_trends(active_trends)
    if invalid_active_trends:
        active_trends = get_active_trends() or []
    _collapse_cached_active_duplicates(active_trends, alias_lookup)
    active_trends = get_active_trends() or []
    review_statuses = get_ai_review_latest_statuses("trend")

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
        summary["deactivated_trends"] = _merge_deactivated_trends(
            invalid_active_trends,
            _deactivate_stale_trends([]),
        )
        return summary

    trend_insights = await get_search_trend_insights(keywords)
    search_data = trend_insights["series"]
    popularity_scores = trend_insights["popularity_scores"]
    popularity_ranks = trend_insights["popularity_ranks"]

    candidates: list[dict] = []
    for keyword, data_points in search_data.items():
        if _is_reference_keyword(keyword):
            summary["skipped_reference_keywords"].append(keyword)
            continue

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
                    "is_rank_only": is_rank_candidate and acceleration < settings.TREND_THRESHOLD,
                }
            )

    summary["candidates"] = len(candidates)
    if not candidates:
        summary["deactivated_trends"] = _merge_deactivated_trends(
            invalid_active_trends,
            _deactivate_stale_trends([]),
        )
        return summary

    novelty_lookback_days = max(
        settings.TREND_NOVELTY_LOOKBACK_DAYS,
        settings.TREND_NOVELTY_RECENT_DAYS + 1,
    )
    novelty_baseline_days = max(
        novelty_lookback_days - settings.TREND_NOVELTY_RECENT_DAYS,
        1,
    )
    novelty_insights = await get_search_trend_insights(
        [candidate["keyword"] for candidate in candidates],
        days=novelty_lookback_days,
    )
    novelty_search_data = novelty_insights["series"]
    rejected_keywords: list[str] = []

    candidate_existing_trends = {
        trend["name"]: trend
        for trend in get_trends_by_names([candidate["keyword"] for candidate in candidates])
        if trend.get("name")
    }

    eligible_candidates: list[dict] = []
    watchlist_only_candidates: list[dict] = []
    for candidate in candidates:
        keyword = candidate["keyword"]
        existing_trend = candidate_existing_trends.get(keyword)
        category_hint = _choose_category(
            keyword,
            keyword_metadata_by_name,
            existing_trend,
        )
        candidate["category_hint"] = category_hint
        if review_statuses.get(normalize_keyword_text(keyword)) in {"pending", "rejected"}:
            continue

        if not is_food_specific_keyword(keyword):
            continue

        blog_insights = await get_blog_search_insights(
            keyword,
            display=settings.TREND_BLOG_SAMPLE_SIZE,
            recent_days=settings.TREND_BLOG_RECENT_DAYS,
        )
        ig_count = await get_hashtag_post_count(keyword)
        novelty_lift = calculate_recent_lift(
            novelty_search_data.get(keyword, candidate["data_points"]),
            recent_days=settings.TREND_NOVELTY_RECENT_DAYS,
            baseline_days=novelty_baseline_days,
        )

        if (
            blog_insights.sampled_count
            and blog_insights.recent_ratio < settings.TREND_BLOG_FRESHNESS_MIN_RATIO
        ):
            summary["filtered_stale_keywords"].append(keyword)
            rejected_keywords.append(keyword)
            continue

        if candidate.get("is_rank_only"):
            if (
                novelty_lift is None
                or novelty_lift < settings.TREND_RANK_ONLY_MIN_LIFT_PCT
            ):
                candidate["force_watchlist"] = True

        if requires_trend_revalidation(keyword):
            if (
                novelty_lift is None
                or novelty_lift < settings.TREND_GENERIC_MIN_LIFT_PCT
                or blog_insights.recent_count < settings.TREND_GENERIC_MIN_RECENT_BLOG_HITS
            ):
                summary["filtered_generic_keywords"].append(keyword)
                rejected_keywords.append(keyword)
                continue

        s_accel = score_acceleration(candidate["acceleration"])
        s_novelty = score_novelty_lift(novelty_lift)
        s_blog = score_blog_freshness(blog_insights)
        s_pop = score_popularity(candidate.get("popularity", 0.0))
        s_rank = score_rank(candidate.get("rank"))
        s_ig = 0.0
        if ig_count is not None:
            if ig_count > 10000:
                s_ig = 8
            elif ig_count > 1000:
                s_ig = 4
        score = s_accel + s_novelty + s_blog + s_pop + s_rank + s_ig

        candidate["score"] = score
        candidate["score_breakdown"] = {
            "acceleration": s_accel,
            "novelty_lift": s_novelty,
            "blog_freshness": s_blog,
            "popularity": s_pop,
            "rank": s_rank,
            "instagram": s_ig,
        }
        candidate["blog_count"] = blog_insights.total_count
        candidate["blog_recent_count"] = blog_insights.recent_count
        candidate["blog_recent_ratio"] = blog_insights.recent_ratio
        candidate["ig_count"] = ig_count
        candidate["novelty_lift"] = novelty_lift

        if candidate.get("force_watchlist"):
            watchlist_only_candidates.append(candidate)
            continue

        if score < settings.TREND_SCORE_THRESHOLD:
            if (
                candidate.get("rank") is not None
                and candidate.get("rank") <= settings.TREND_TOP_RANK_CANDIDATE_MAX
            ):
                candidate["force_watchlist"] = True
                watchlist_only_candidates.append(candidate)
            continue
        eligible_candidates.append(candidate)

    if not eligible_candidates and not watchlist_only_candidates:
        summary["deactivated_trends"] = _merge_deactivated_trends(
            invalid_active_trends,
            _deactivate_rejected_active_trends(rejected_keywords),
            _deactivate_stale_trends([]),
        )
        return summary

    review_results: dict[str, TrendReviewResult] = {}
    review_payloads_by_keyword: dict[str, TrendReviewPayload] = {}
    if settings.AI_REVIEW_ENABLED and eligible_candidates:
        reservation = reserve_automation_ai_call("trend_detection", trigger)
        summary["ai_calls_remaining"] = reservation.remaining_today
        if not reservation.allowed:
            summary["budget_exhausted"] = True
        else:
            review_payloads = await _build_review_payloads(eligible_candidates)
            review_payloads_by_keyword = {
                payload.keyword: payload for payload in review_payloads
            }
            try:
                review_results, request_count = await review_trend_candidates(review_payloads)
                summary["ai_calls_used"] += request_count
                summary["ai_reviewed"] = len(review_payloads)
                (
                    summary["ai_grounding_status"],
                    summary["ai_grounding_detail"],
                    summary["ai_grounding_queries"],
                    summary["ai_grounding_sources"],
                ) = _summarize_ai_grounding(review_results)
            except AIReviewError as exc:
                summary["ai_calls_used"] += exc.request_count
                summary["ai_fallback_details"].append(
                    _build_ai_detail_line(
                        "batch",
                        confidence=None,
                        category=DEFAULT_CATEGORY,
                        reason=str(exc),
                    )
                )
                logger.warning("AI trend batch review failed: %s", exc)
                await send_discord_message(f"[⚠️ AI 검토 실패] 트렌드 배치 리뷰 실패 (모델: {settings.AI_REVIEW_MODEL}): {exc}")

    confirmed_groups: dict[str, dict] = {}
    alias_rows_to_upsert: list[dict] = []

    for candidate in watchlist_only_candidates:
        keyword = clean_display_keyword(candidate["keyword"])
        category = candidate["category_hint"]
        cluster_key = normalize_keyword_text(keyword)
        group = confirmed_groups.setdefault(
            cluster_key,
            {
                "candidates": [],
                "ai_terms": [],
                "confidence": None,
                "review": None,
                "consecutive_accepts": 0,
                "has_eligible_candidate": False,
                "needs_watchlist": False,
            },
        )
        group["candidates"].append({**candidate, "category": category})
        group["ai_terms"].append(keyword)
        group["needs_watchlist"] = True

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

            # Phase 1: AI 리뷰 결과를 trend_reviews 테이블에 저장
            existing_for_review = candidate_existing_trends.get(keyword)
            review_trend_id = (
                existing_for_review.get("id") if existing_for_review else None
            )
            insert_trend_review({
                "trend_id": review_trend_id,
                "keyword": keyword,
                "verdict": review.verdict,
                "confidence": review.confidence,
                "reason": review.reason,
                "category": category,
                "model": review.model,
                "grounding_used": review.grounding_used,
                "grounding_queries": review.grounding_queries,
                "grounding_sources": review.grounding_sources,
                "trigger": trigger,
                "score": candidate.get("score"),
                "acceleration": candidate.get("acceleration"),
                "novelty_lift": candidate.get("novelty_lift"),
                "score_breakdown": candidate.get("score_breakdown"),
            })
            summary["ai_reviews_persisted"] += 1

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
                        grounding_queries=review.grounding_queries,
                        grounding_sources=review.grounding_sources,
                    )
                )

                # Phase 3: hysteresis — 연속 카운트 기반 탈락 판정
                if review.verdict == "reject":
                    prev_rejects = (
                        existing_for_review.get("ai_consecutive_rejects", 0)
                        if existing_for_review
                        else 0
                    )
                    consecutive_rejects = prev_rejects + 1
                    if existing_for_review and existing_for_review.get("id"):
                        update_trend_verdict_counts(
                            existing_for_review["id"], 0, consecutive_rejects,
                        )
                    if consecutive_rejects >= settings.TREND_ACTIVE_DEMOTION_REJECTS:
                        rejected_keywords.append(keyword)
                    continue

                queue_result = upsert_ai_review_queue_entry(
                    {
                        "source_job": "trend_detection",
                        "item_type": "trend",
                        "candidate_key": normalize_keyword_text(keyword),
                        "candidate_name": keyword,
                        "category": category,
                        "confidence": review.confidence,
                        "ai_verdict": review.verdict,
                        "reason": review.reason,
                        "model": review.model,
                        "trend_id": review_trend_id,
                        "trigger": trigger,
                        "payload": _build_review_queue_payload(
                            candidate,
                            category=category,
                            review=review,
                            existing_trend=existing_for_review,
                        ),
                    }
                )
                if queue_result is not None:
                    summary["ai_reviews_queued"] += 1
                continue

            # Phase 3: AI accept — 연속 accept 카운트 업데이트
            prev_accepts = (
                existing_for_review.get("ai_consecutive_accepts", 0)
                if existing_for_review
                else 0
            )
            consecutive_accepts = prev_accepts + 1
            if existing_for_review and existing_for_review.get("id"):
                update_trend_verdict_counts(
                    existing_for_review["id"], consecutive_accepts, 0,
                )

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
                "review": None,
                "consecutive_accepts": 0,
                "has_eligible_candidate": False,
                "needs_watchlist": False,
            },
        )
        group["candidates"].append({**candidate, "category": category})
        group["ai_terms"].extend(ai_terms)
        group["has_eligible_candidate"] = True
        if confidence is not None:
            group["confidence"] = max(group["confidence"] or 0.0, confidence)
        if review is not None:
            group["review"] = review
        if review is not None and existing_for_review:
            group["consecutive_accepts"] = consecutive_accepts

    if not confirmed_groups:
        summary["deactivated_trends"] = _merge_deactivated_trends(
            invalid_active_trends,
            _deactivate_rejected_active_trends(rejected_keywords),
            _deactivate_stale_trends([]),
        )
        return summary

    consumed_existing_ids: set[str] = set()
    confirmed_keywords: list[str] = []
    new_confirmed_keywords: list[str] = []
    trend_plans: list[dict] = []

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

        matching_active_trends = _find_matching_existing_trends(
            active_trends,
            search_terms=search_terms,
            consumed_trend_ids=consumed_existing_ids,
            alias_lookup=alias_lookup,
        )
        matching_existing_trends = _dedupe_existing_trends(
            matching_active_trends,
            _find_persisted_matching_trends(
                search_terms=search_terms,
                consumed_trend_ids=consumed_existing_ids,
                alias_lookup=alias_lookup,
            ),
        )
        is_new_trend = not matching_active_trends
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
        existing_status = (
            primary_existing_trend.get("status")
            if primary_existing_trend
            else None
        )
        consecutive_accepts = group.get("consecutive_accepts", 0)
        if not group.get("has_eligible_candidate") and group.get("needs_watchlist"):
            status = "watchlist"
        else:
            status = classify_status(
                representative_candidate["score"],
                representative_candidate["acceleration"],
                existing_status=existing_status,
                consecutive_accepts=consecutive_accepts,
            )
        if status == "watchlist":
            summary["watchlist_count"] += 1
        elif existing_status == "watchlist" and status in ("active", "rising"):
            summary["promoted_from_watchlist"].append(display_keyword)
        if is_new_trend and status != "watchlist":
            new_confirmed_keywords.append(display_keyword)
        trend_plans.append(
            {
                "trend_id": trend_id,
                "display_keyword": display_keyword,
                "category": category,
                "status": status,
                "search_terms": search_terms,
                "group_candidates": group_candidates,
                "primary_existing_trend": primary_existing_trend,
                "representative_candidate": representative_candidate,
                "review": group.get("review"),
                "consecutive_accepts": consecutive_accepts,
            }
        )

    descriptions_by_keyword: dict[str, str] = {}
    if settings.AI_REVIEW_ENABLED and review_results and review_payloads_by_keyword:
        description_payloads = [
            TrendDescriptionPayload(
                keyword=plan["display_keyword"],
                category=plan["category"],
                evidence_snippets=_collect_description_snippets(
                    plan["group_candidates"],
                    review_payloads_by_keyword,
                ),
            )
            for plan in trend_plans
            if not (
                plan["primary_existing_trend"]
                and plan["primary_existing_trend"].get("description")
            )
        ]
        description_payloads = [
            payload for payload in description_payloads if payload.evidence_snippets
        ]
        if description_payloads:
            try:
                descriptions_by_keyword, request_count = await generate_trend_descriptions(
                    description_payloads
                )
                summary["ai_calls_used"] += request_count
            except AIReviewError as exc:
                summary["ai_calls_used"] += exc.request_count
                summary["ai_fallback_details"].append(
                    _build_ai_detail_line(
                        "description",
                        confidence=None,
                        category=DEFAULT_CATEGORY,
                        reason=str(exc),
                    )
                )
                logger.warning("AI trend description generation failed: %s", exc)
                await send_discord_message(f"[⚠️ AI 검토 실패] 트렌드 설명 생성 실패 (모델: {settings.AI_REVIEW_MODEL}): {exc}")

    for plan in trend_plans:
        primary_existing_trend = plan["primary_existing_trend"]
        display_keyword = plan["display_keyword"]
        category = plan["category"]
        representative_candidate = plan["representative_candidate"]
        trend_data = {
            "id": plan["trend_id"],
            "name": display_keyword,
            "category": category,
            "status": plan["status"],
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "peak_score": representative_candidate["score"],
            "score_breakdown": representative_candidate.get("score_breakdown"),
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
            "ai_consecutive_accepts": plan.get("consecutive_accepts", 0),
            "ai_consecutive_rejects": 0,
        }

        # Phase 1: AI 판정 정보를 trends 테이블에 저장
        review = plan.get("review")
        if review is not None:
            trend_data["ai_verdict"] = review.verdict
            trend_data["ai_reason"] = review.reason
            trend_data["ai_confidence"] = review.confidence
            trend_data["ai_grounding_sources"] = review.grounding_sources
            trend_data["ai_reviewed_at"] = datetime.now(timezone.utc).isoformat()
            trend_data["ai_model"] = review.model

        if _should_refresh_image(primary_existing_trend, display_keyword):
            image_url = await find_food_image(
                display_keyword,
                category=category,
                existing_image_url=trend_data["image_url"],
            )
            if image_url:
                trend_data["image_url"] = image_url

        generated_description = descriptions_by_keyword.get(display_keyword)
        if not trend_data["description"] and generated_description:
            trend_data["description"] = generated_description
            summary["generated_descriptions"] += 1

        upsert_trend(trend_data)
        summary["stored_trends"] += 1

        if plan["status"] != "watchlist":
            stores = await find_stores_nationwide(plan["search_terms"])
            if stores:
                store_records = build_store_records(plan["trend_id"], stores)
                insert_stores(store_records)
                summary["stored_stores"] += len(store_records)

    upsert_keyword_aliases(alias_rows_to_upsert)
    deduped_confirmed_keywords = dedupe_terms(confirmed_keywords)
    deduped_new_confirmed_keywords = dedupe_terms(new_confirmed_keywords)
    summary["confirmed"] = len(deduped_confirmed_keywords)
    summary["confirmed_keywords"] = deduped_confirmed_keywords
    summary["new_confirmed_keywords"] = deduped_new_confirmed_keywords
    summary["deactivated_trends"] = _merge_deactivated_trends(
        invalid_active_trends,
        _deactivate_rejected_active_trends(rejected_keywords),
        _deactivate_stale_trends(deduped_confirmed_keywords),
    )

    logger.info(
        "=== trend detection finished: %s confirmed, %s stores, %s descriptions ===",
        summary["confirmed"],
        summary["stored_stores"],
        summary["generated_descriptions"],
    )
    return summary
