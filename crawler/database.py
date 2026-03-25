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


def insert_keywords(keywords: list[dict]):
    """키워드 일괄 등록 (중복 시 무시)"""
    if not keywords:
        return
    return get_client().table("keywords").upsert(
        keywords, on_conflict="keyword"
    ).execute()


def update_trend_status(trend_id: str, status: str):
    return (
        get_client()
        .table("trends")
        .update({"status": status})
        .eq("id", trend_id)
        .execute()
    )
