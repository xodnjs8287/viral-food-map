import logging
import uuid
from datetime import datetime

from ai_reviewer import AIReviewError, TrendReviewPayload, review_trend_candidate
from config import settings
from crawlers.image_finder import find_food_image
from crawlers.instagram import get_hashtag_post_count
from crawlers.naver_datalab import calculate_acceleration, get_search_trend
from crawlers.naver_search import get_blog_mention_count, search_blog_mentions
from crawlers.store_finder import find_stores_nationwide
from database import (
    get_all_keywords,
    get_trends_by_names,
    insert_stores,
    upsert_trend,
)
from detector.keyword_manager import get_flat_keywords, is_food_specific_keyword
from detector.store_updater import build_store_records

logger = logging.getLogger(__name__)


def score_acceleration(acceleration: float) -> float:
    if acceleration >= settings.TREND_RISING_ACCELERATION_THRESHOLD:
        return 20
    if acceleration >= 50:
        return 15
    if acceleration >= settings.TREND_THRESHOLD:
        return 10
    return 0


def classify_status(score: float, acceleration: float) -> str:
    if (
        score >= settings.TREND_RISING_SCORE_THRESHOLD
        or acceleration >= settings.TREND_RISING_ACCELERATION_THRESHOLD
    ):
        return "rising"
    return "active"


def _build_search_volume_map(data_points: list[dict]) -> dict[str, float]:
    return {
        point.get("period", ""): point.get("ratio", 0)
        for point in data_points
        if point.get("period")
    }


def _choose_category(
    keyword: str,
    db_keywords_by_name: dict[str, dict],
    existing_trend: dict | None,
) -> str:
    if keyword in db_keywords_by_name:
        return db_keywords_by_name[keyword].get("category") or "기타"
    if existing_trend:
        return existing_trend.get("category") or "기타"
    return "기타"


async def _review_candidate_with_ai(
    candidate: dict,
    *,
    category_hint: str,
) -> tuple[bool, str, str, str, str]:
    keyword = candidate["keyword"]
    review = await review_trend_candidate(
        TrendReviewPayload(
            keyword=keyword,
            acceleration=candidate["acceleration"],
            search_volume_data=_build_search_volume_map(candidate["data_points"]),
            blog_count=candidate["blog_count"],
            ig_count=candidate["ig_count"],
            category_hint=category_hint,
            evidence_snippets=await search_blog_mentions(
                keyword,
                display=settings.AI_REVIEW_MAX_EVIDENCE_SNIPPETS,
            ),
        )
    )

    resolved_keyword = review.canonical_keyword or keyword
    resolved_category = (
        review.category
        if review.category != "기타" or category_hint == "기타"
        else category_hint
    )
    accepted = (
        review.verdict == "accept"
        and review.confidence >= settings.AI_REVIEW_MIN_CONFIDENCE
    )
    return (
        accepted,
        resolved_keyword,
        resolved_category,
        review.reason,
        review.verdict,
    )


async def detect_trends() -> dict:
    logger.info("=== trend detection started ===")

    db_keywords = get_all_keywords() or []
    db_keywords_by_name = {
        item["keyword"]: item
        for item in db_keywords
        if item.get("keyword")
    }
    keywords = list(db_keywords_by_name) if db_keywords_by_name else get_flat_keywords()

    summary = {
        "keywords": len(keywords),
        "candidates": 0,
        "confirmed": 0,
        "stored_trends": 0,
        "stored_stores": 0,
        "confirmed_keywords": [],
        "ai_reviewed": 0,
        "ai_rejected_keywords": [],
        "ai_review_keywords": [],
        "ai_fallback_keywords": [],
    }

    logger.info("Monitoring %s keywords", len(keywords))

    search_data = await get_search_trend(keywords)

    candidates = []
    for keyword, data_points in search_data.items():
        acceleration = calculate_acceleration(data_points)
        if acceleration >= settings.TREND_THRESHOLD:
            candidates.append({
                "keyword": keyword,
                "acceleration": acceleration,
                "data_points": data_points,
            })
            logger.info(
                "Candidate detected: %s (acceleration %.1f%%)",
                keyword,
                acceleration,
            )

    summary["candidates"] = len(candidates)

    if not candidates:
        logger.info("No rapidly rising keywords found")
        return summary

    candidate_existing_trends = {
        trend["name"]: trend
        for trend in get_trends_by_names([candidate["keyword"] for candidate in candidates])
        if trend.get("name")
    }

    confirmed_by_name: dict[str, dict] = {}
    for candidate in candidates:
        keyword = candidate["keyword"]
        existing_trend = candidate_existing_trends.get(keyword)
        category_hint = _choose_category(keyword, db_keywords_by_name, existing_trend)

        if not is_food_specific_keyword(keyword):
            logger.info("Skipping generic keyword: %s", keyword)
            continue

        score = 0.0

        blog_count = await get_blog_mention_count(keyword)
        if blog_count > 1000:
            score += 30
        elif blog_count > 100:
            score += 15

        ig_count = await get_hashtag_post_count(keyword)
        if ig_count is not None:
            if ig_count > 10000:
                score += 30
            elif ig_count > 1000:
                score += 15

        score += score_acceleration(candidate["acceleration"])

        candidate["score"] = score
        candidate["blog_count"] = blog_count
        candidate["ig_count"] = ig_count

        if score < settings.TREND_SCORE_THRESHOLD:
            logger.info("Candidate below score threshold: %s (score %.1f)", keyword, score)
            continue

        resolved_keyword = keyword
        resolved_category = category_hint
        ai_reason = ""

        if settings.AI_REVIEW_ENABLED:
            try:
                accepted, resolved_keyword, resolved_category, ai_reason, ai_verdict = (
                    await _review_candidate_with_ai(
                        candidate,
                        category_hint=category_hint,
                    )
                )
                summary["ai_reviewed"] += 1
                if not accepted:
                    if ai_reason:
                        logger.info("AI blocked trend '%s': %s", keyword, ai_reason)
                    target_key = (
                        "ai_rejected_keywords"
                        if ai_verdict == "reject"
                        else "ai_review_keywords"
                    )
                    summary[target_key].append(keyword)
                    continue

                logger.info(
                    "AI accepted trend '%s' as '%s' (%s)",
                    keyword,
                    resolved_keyword,
                    ai_reason or "no reason",
                )
            except AIReviewError as exc:
                summary["ai_fallback_keywords"].append(keyword)
                logger.warning(
                    "AI review failed for '%s', falling back to rules: %s",
                    keyword,
                    exc,
                )

        candidate["keyword"] = resolved_keyword
        candidate["category"] = resolved_category
        candidate["ai_reason"] = ai_reason

        existing_confirmed = confirmed_by_name.get(resolved_keyword)
        if not existing_confirmed or candidate["score"] > existing_confirmed["score"]:
            confirmed_by_name[resolved_keyword] = candidate

    confirmed = list(confirmed_by_name.values())
    summary["confirmed"] = len(confirmed)
    summary["confirmed_keywords"] = [trend["keyword"] for trend in confirmed]

    existing_trends = {
        trend["name"]: trend
        for trend in get_trends_by_names(summary["confirmed_keywords"])
        if trend.get("name")
    }

    for trend in confirmed:
        keyword = trend["keyword"]
        existing_trend = existing_trends.get(keyword)
        category = trend.get("category") or _choose_category(
            keyword,
            db_keywords_by_name,
            existing_trend,
        )
        trend_id = existing_trend["id"] if existing_trend else str(uuid.uuid4())
        status = classify_status(trend["score"], trend["acceleration"])

        trend_data = {
            "id": trend_id,
            "name": keyword,
            "category": category,
            "status": status,
            "detected_at": datetime.now().isoformat(),
            "peak_score": trend["score"],
            "search_volume_data": _build_search_volume_map(trend["data_points"]),
            "description": existing_trend.get("description") if existing_trend else None,
            "image_url": existing_trend.get("image_url") if existing_trend else None,
        }

        if not trend_data["image_url"]:
            image_url = await find_food_image(keyword, category=category)
            if image_url:
                trend_data["image_url"] = image_url
                logger.info("Fetched fallback image for '%s'", keyword)

        upsert_trend(trend_data)
        summary["stored_trends"] += 1

        stores = await find_stores_nationwide(keyword)
        if stores:
            store_records = build_store_records(trend_id, stores)
            insert_stores(store_records)
            summary["stored_stores"] += len(store_records)
            logger.info("Stored %s stores for '%s'", len(store_records), keyword)

    logger.info("=== trend detection finished: %s confirmed ===", len(confirmed))
    return summary
