from supabase import create_client, Client
from config import settings

_client: Client | None = None


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


def upsert_trend(trend_data: dict):
    return get_client().table("trends").upsert(trend_data).execute()


def insert_stores(stores: list[dict]):
    if not stores:
        return
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


def get_store_trend_lookup(batch_size: int = 1000):
    client = get_client()
    rows = []
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
    """키워드 일괄 등록 (중복 시 무시)"""
    if not keywords:
        return
    return get_client().table("keywords").upsert(
        keywords, on_conflict="keyword"
    ).execute()


# alias for backward compatibility
upsert_keywords = insert_keywords


def update_trend_status(trend_id: str, status: str):
    return (
        get_client()
        .table("trends")
        .update({"status": status})
        .eq("id", trend_id)
        .execute()
    )
