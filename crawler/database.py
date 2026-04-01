from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

from config import settings

_client: Client | None = None
logger = logging.getLogger(__name__)
_warned_failures: set[str] = set()


def _warn_once(key: str, message: str, exc: Exception) -> None:
    if key in _warned_failures:
        return
    _warned_failures.add(key)
    logger.warning("%s: %s", message, exc)


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _client


def get_active_trends():
    return (
        get_client()
        .table("trends")
        .select("*")
        .in_("status", ["rising", "active"])
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
        .select("id,name,category,description,image_url,status,peak_score,detected_at")
        .in_("name", names)
        .execute()
        .data
        or []
    )


def upsert_trend(trend_data: dict):
    return get_client().table("trends").upsert(trend_data).execute()


def insert_stores(stores: list[dict]):
    if not stores:
        return None
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


def update_trend_status(trend_id: str, status: str):
    return (
        get_client()
        .table("trends")
        .update({"status": status})
        .eq("id", trend_id)
        .execute()
    )


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


def upsert_yomechu_places(places: list[dict[str, Any]]):
    if not places:
        return None
    return (
        get_client()
        .table("yomechu_places")
        .upsert(places, on_conflict="external_place_id")
        .execute()
    )


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


def insert_yomechu_spin(spin_row: dict[str, Any]) -> dict[str, Any] | None:
    result = get_client().table("yomechu_spins").insert(spin_row).execute()
    data = result.data or []
    return data[0] if data else None


def insert_yomechu_feedback(feedback_row: dict[str, Any]) -> dict[str, Any] | None:
    result = get_client().table("yomechu_feedback").insert(feedback_row).execute()
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
