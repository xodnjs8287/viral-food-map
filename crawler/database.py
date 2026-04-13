from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from postgrest.exceptions import APIError
from supabase import Client, create_client

from config import settings

_client: Client | None = None
logger = logging.getLogger(__name__)
_warned_failures: set[str] = set()
UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _warn_once(key: str, message: str, exc: Exception) -> None:
    if key in _warned_failures:
        return
    _warned_failures.add(key)
    logger.warning("%s: %s", message, exc)


def get_client() -> Client:
    global _client
    if _client is not None:
        return _client

    url = (settings.SUPABASE_URL or "").strip()
    key = (settings.SUPABASE_KEY or "").strip()

    if not url or not key:
        missing = ", ".join(
            name for name, val in [("SUPABASE_URL", url), ("SUPABASE_KEY", key)] if not val
        )
        raise RuntimeError(
            f"Supabase credentials not configured ({missing}). "
            "Set the environment variables before starting the server."
        )

    try:
        _client = create_client(url, key)
    except Exception as exc:
        raise RuntimeError(f"Failed to initialize Supabase client: {exc}") from exc

    return _client


def _reset_client() -> None:
    global _client
    _client = None


def get_active_trends():
    return (
        get_client()
        .table("trends")
        .select("*")
        .in_("status", ["rising", "active", "declining", "watchlist"])
        .execute()
        .data
    )


def get_all_keywords():
    return (
        get_client()
        .table("keywords")
        .select("*")
        .eq("is_active", True)
        .execute()
        .data
    )


def get_trends_by_names(names: list[str]):
    if not names:
        return []
    return (
        get_client()
        .table("trends")
        .select(
            "id,name,category,description,image_url,status,peak_score,detected_at,"
            "ai_consecutive_accepts,ai_consecutive_rejects"
        )
        .in_("name", names)
        .execute()
        .data
        or []
    )


def upsert_trend(trend_data: dict):
    try:
        return get_client().table("trends").upsert(trend_data).execute()
    except APIError as exc:
        trend_name = trend_data.get("name")
        if exc.code != "23505" or not trend_name:
            raise

        existing_trends = get_trends_by_names([trend_name])
        existing_trend = existing_trends[0] if existing_trends else None
        existing_trend_id = existing_trend.get("id") if existing_trend else None
        if not existing_trend_id:
            raise

        logger.info(
            "retrying duplicate trend name upsert with existing id: %s (%s)",
            trend_name,
            existing_trend_id,
        )
        update_payload = {
            key: value for key, value in trend_data.items() if key != "id"
        }
        return (
            get_client()
            .table("trends")
            .update(update_payload)
            .eq("id", existing_trend_id)
            .execute()
        )


def insert_stores(stores: list[dict]):
    if not stores:
        return None
    try:
        return get_client().table("stores").upsert(
            stores, on_conflict="trend_id,name,address"
        ).execute()
    except httpx.LocalProtocolError:
        logger.warning("HTTP/2 protocol error on insert_stores, resetting client and retrying")
        _reset_client()
        return get_client().table("stores").upsert(
            stores, on_conflict="trend_id,name,address"
        ).execute()


def get_stores_by_trend_ids(trend_ids: list[str]):
    if not trend_ids:
        return []
    return (
        get_client()
        .table("stores")
        .select("trend_id,name,address")
        .in_("trend_id", trend_ids)
        .execute()
        .data
    )


def get_store_trend_lookup(batch_size: int = 1000) -> list[dict[str, Any]]:
    client = get_client()
    rows: list[dict[str, Any]] = []
    start = 0

    while True:
        result = (
            client.table("stores")
            .select("name,address,trends(name)")
            .range(start, start + batch_size - 1)
            .execute()
        )
        batch = result.data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < batch_size:
            break
        start += batch_size

    return rows


def insert_keywords(keywords: list[dict]):
    if not keywords:
        return None
    return get_client().table("keywords").upsert(
        keywords, on_conflict="keyword"
    ).execute()


upsert_keywords = insert_keywords


def _prepare_keyword_names(keywords: list[str]) -> list[str]:
    return sorted(
        {
            str(keyword or "").strip()
            for keyword in keywords
            if str(keyword or "").strip()
        }
    )


def mark_keywords_checked(
    keywords: list[str],
    *,
    checked_at: str | None = None,
):
    keyword_names = _prepare_keyword_names(keywords)
    if not keyword_names:
        return None

    payload = {
        "last_checked": checked_at or datetime.now(timezone.utc).isoformat(),
    }
    try:
        return (
            get_client()
            .table("keywords")
            .update(payload)
            .in_("keyword", keyword_names)
            .execute()
        )
    except Exception as exc:
        _warn_once(
            "keywords_mark_checked",
            "keywords last_checked update unavailable",
            exc,
        )
        return None


def mark_keywords_confirmed(
    keywords: list[str],
    *,
    confirmed_at: str | None = None,
):
    keyword_names = _prepare_keyword_names(keywords)
    if not keyword_names:
        return None

    timestamp = confirmed_at or datetime.now(timezone.utc).isoformat()
    payload = {
        "last_checked": timestamp,
        "last_confirmed_at": timestamp,
        "is_active": True,
    }
    try:
        return (
            get_client()
            .table("keywords")
            .update(payload)
            .in_("keyword", keyword_names)
            .execute()
        )
    except Exception as exc:
        _warn_once(
            "keywords_mark_confirmed",
            "keywords confirmation update unavailable",
            exc,
        )
        return None


def deactivate_keywords(keywords: list[str]):
    keyword_names = _prepare_keyword_names(keywords)
    if not keyword_names:
        return None

    try:
        return (
            get_client()
            .table("keywords")
            .update({"is_active": False})
            .in_("keyword", keyword_names)
            .execute()
        )
    except Exception as exc:
        _warn_once(
            "keywords_deactivate",
            "keywords deactivation unavailable",
            exc,
        )
        return None


def update_trend_status(trend_id: str, status: str):
    return (
        get_client()
        .table("trends")
        .update({"status": status})
        .eq("id", trend_id)
        .execute()
    )


def update_trend_verdict_counts(
    trend_id: str,
    consecutive_accepts: int,
    consecutive_rejects: int,
):
    return (
        get_client()
        .table("trends")
        .update({
            "ai_consecutive_accepts": consecutive_accepts,
            "ai_consecutive_rejects": consecutive_rejects,
        })
        .eq("id", trend_id)
        .execute()
    )


def insert_trend_review(review_data: dict):
    try:
        return get_client().table("trend_reviews").insert(review_data).execute()
    except Exception as exc:
        _warn_once(
            "trend_review_insert",
            "trend_reviews insert unavailable",
            exc,
        )
        return None


def upsert_ai_review_queue_entry(entry_data: dict[str, Any]):
    payload = {
        **entry_data,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    payload.setdefault("status", "pending")

    try:
        existing_rows = (
            get_client()
            .table("ai_review_queue")
            .select("id")
            .eq("item_type", payload.get("item_type"))
            .eq("candidate_key", payload.get("candidate_key"))
            .eq("status", "pending")
            .limit(1)
            .execute()
            .data
            or []
        )
        if existing_rows:
            return (
                get_client()
                .table("ai_review_queue")
                .update(payload)
                .eq("id", existing_rows[0]["id"])
                .execute()
            )

        return get_client().table("ai_review_queue").insert(payload).execute()
    except Exception as exc:
        _warn_once(
            "ai_review_queue_upsert",
            "ai_review_queue upsert unavailable",
            exc,
        )
        return None


def get_ai_review_latest_statuses(item_type: str) -> dict[str, str]:
    try:
        rows = (
            get_client()
            .table("ai_review_queue")
            .select("candidate_key,status,updated_at,created_at")
            .eq("item_type", item_type)
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        _warn_once(
            "ai_review_queue_statuses",
            "ai_review_queue status lookup unavailable",
            exc,
        )
        return {}

    latest_statuses: dict[str, str] = {}
    for row in rows:
        candidate_key = str(row.get("candidate_key") or "").strip()
        status = str(row.get("status") or "").strip()
        if not candidate_key or not status or candidate_key in latest_statuses:
            continue
        latest_statuses[candidate_key] = status

    return latest_statuses


def get_recent_reviews_by_keyword(keyword: str, limit: int = 10) -> list[dict]:
    try:
        return (
            get_client()
            .table("trend_reviews")
            .select("*")
            .eq("keyword", keyword)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        _warn_once(
            "trend_review_lookup",
            "trend_reviews lookup unavailable",
            exc,
        )
        return []


def get_keyword_aliases():
    try:
        return (
            get_client()
            .table("keyword_aliases")
            .select("*")
            .execute()
            .data
            or []
        )
    except Exception as exc:
        _warn_once("keyword_aliases_lookup", "keyword_aliases lookup unavailable", exc)
        return []


def upsert_keyword_aliases(rows: list[dict]):
    if not rows:
        return None

    payload = [
        {
            **row,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }
        for row in rows
    ]
    try:
        return (
            get_client()
            .table("keyword_aliases")
            .upsert(payload, on_conflict="alias_normalized")
            .execute()
        )
    except Exception as exc:
        _warn_once("keyword_aliases_upsert", "keyword_aliases upsert unavailable", exc)
        return None


def get_keyword_aliases_by_canonical_keywords(
    canonical_keywords: list[str],
) -> list[dict[str, Any]]:
    if not canonical_keywords:
        return []
    try:
        return (
            get_client()
            .table("keyword_aliases")
            .select("*")
            .in_("canonical_keyword", canonical_keywords)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        _warn_once(
            "keyword_aliases_by_canonical",
            "keyword_aliases canonical lookup unavailable",
            exc,
        )
        return []


def get_stores_by_trend_id(trend_id: str) -> list[dict[str, Any]]:
    return (
        get_client()
        .table("stores")
        .select("*")
        .eq("trend_id", trend_id)
        .execute()
        .data
        or []
    )


def delete_stores_by_trend_id(trend_id: str):
    return (
        get_client()
        .table("stores")
        .delete()
        .eq("trend_id", trend_id)
        .execute()
    )


def count_ai_automation_usage(usage_date: str) -> int:
    try:
        response = (
            get_client()
            .table("ai_automation_usage")
            .select("id", count="exact", head=True)
            .eq("usage_date", usage_date)
            .execute()
        )
        return response.count or 0
    except Exception as exc:
        _warn_once(
            "ai_automation_usage_count",
            "ai_automation_usage count unavailable",
            exc,
        )
        raise


def insert_ai_automation_usage(row: dict[str, Any]):
    try:
        return get_client().table("ai_automation_usage").insert(row).execute()
    except Exception as exc:
        _warn_once(
            "ai_automation_usage_insert",
            "ai_automation_usage insert unavailable",
            exc,
        )
        raise


def upsert_yomechu_places(places: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not places:
        return []
    result = (
        get_client()
        .table("yomechu_places")
        .upsert(places, on_conflict="external_place_id")
        .execute()
    )
    return result.data or []


def get_yomechu_places_by_external_ids(
    external_place_ids: list[str],
) -> list[dict[str, Any]]:
    if not external_place_ids:
        return []
    return (
        get_client()
        .table("yomechu_places")
        .select("*")
        .in_("external_place_id", external_place_ids)
        .execute()
        .data
        or []
    )


def is_uuid_like(value: str | None) -> bool:
    return bool(value and UUID_PATTERN.fullmatch(value))


def resolve_yomechu_feedback_place_id(place_id: str | None) -> str | None:
    if not place_id:
        return None

    if is_uuid_like(place_id):
        return place_id

    rows = get_yomechu_places_by_external_ids([place_id])
    if not rows:
        return None

    return rows[0].get("id")


def insert_yomechu_spin(spin_row: dict[str, Any]) -> dict[str, Any] | None:
    result = get_client().table("yomechu_spins").insert(spin_row).execute()
    data = result.data or []
    return data[0] if data else None


def insert_yomechu_feedback(feedback_row: dict[str, Any]) -> dict[str, Any] | None:
    payload = dict(feedback_row)
    original_place_id = payload.get("place_id")
    resolved_place_id = resolve_yomechu_feedback_place_id(original_place_id)

    if original_place_id and resolved_place_id != original_place_id:
        metadata = dict(payload.get("payload") or {})
        metadata.setdefault("raw_place_id", original_place_id)
        payload["payload"] = metadata

    payload["place_id"] = resolved_place_id

    result = get_client().table("yomechu_feedback").insert(payload).execute()
    data = result.data or []
    return data[0] if data else None


def list_recent_yomechu_places(batch_size: int) -> list[dict[str, Any]]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    result = (
        get_client()
        .table("yomechu_places")
        .select("*")
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", desc=True)
        .limit(max(batch_size * 4, batch_size))
        .execute()
    )
    return result.data or []


def update_yomechu_place(
    place_id: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    result = (
        get_client()
        .table("yomechu_places")
        .update(payload)
        .eq("id", place_id)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def get_instagram_feed_run_by_date(run_date: str) -> dict[str, Any] | None:
    try:
        result = (
            get_client()
            .table("instagram_feed_runs")
            .select("*")
            .eq("run_date", run_date)
            .limit(1)
            .execute()
        )
        data = result.data or []
        return data[0] if data else None
    except Exception as exc:
        _warn_once(
            "instagram_feed_runs_lookup",
            "instagram_feed_runs lookup unavailable",
            exc,
        )
        return None


def create_instagram_feed_run(payload: dict[str, Any]) -> dict[str, Any] | None:
    try:
        result = get_client().table("instagram_feed_runs").insert(payload).execute()
        data = result.data or []
        return data[0] if data else None
    except Exception as exc:
        _warn_once(
            "instagram_feed_runs_insert",
            "instagram_feed_runs insert unavailable",
            exc,
        )
        raise


def update_instagram_feed_run(
    run_id: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    try:
        result = (
            get_client()
            .table("instagram_feed_runs")
            .update(payload)
            .eq("id", run_id)
            .execute()
        )
        data = result.data or []
        return data[0] if data else None
    except Exception as exc:
        _warn_once(
            "instagram_feed_runs_update",
            "instagram_feed_runs update unavailable",
            exc,
        )
        raise


def list_instagram_feed_runs(limit: int = 30) -> list[dict[str, Any]]:
    try:
        result = (
            get_client()
            .table("instagram_feed_runs")
            .select("*")
            .order("run_date", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        _warn_once(
            "instagram_feed_runs_list",
            "instagram_feed_runs list unavailable",
            exc,
        )
        return []


def list_published_instagram_trend_ids() -> list[str]:
    try:
        result = (
            get_client()
            .table("instagram_feed_runs")
            .select("trend_id")
            .eq("status", "published")
            .not_.is_("trend_id", "null")
            .execute()
        )
        rows = result.data or []
        return [row["trend_id"] for row in rows if row.get("trend_id")]
    except Exception as exc:
        _warn_once(
            "instagram_feed_runs_published",
            "instagram_feed_runs published lookup unavailable",
            exc,
        )
        return []
