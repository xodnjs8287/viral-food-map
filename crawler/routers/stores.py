import logging

from fastapi import APIRouter
from pydantic import BaseModel

from database import get_client
from franchise_checker import is_franchise

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stores", tags=["stores"])


class ReportRequest(BaseModel):
    trend_id: str
    store_name: str
    address: str
    note: str | None = None


@router.get("")
async def list_stores(trend_id: str | None = None):
    """판매처 목록 (트렌드 필터 가능)"""
    query = get_client().table("stores").select("*")
    if trend_id:
        query = query.eq("trend_id", trend_id)
    return query.execute().data


@router.post("/report")
async def submit_report(report: ReportRequest):
    """사용자 판매처 제보"""
    data = {
        "trend_id": report.trend_id,
        "store_name": report.store_name,
        "address": report.address,
        "note": report.note,
        "status": "pending",
    }
    result = get_client().table("reports").insert(data).execute()
    return {"message": "제보가 접수되었습니다", "data": result.data}


@router.post("/backfill-franchise")
async def backfill_franchise():
    """기존 매장의 is_franchise 필드를 일괄 업데이트"""
    client = get_client()
    rows: list[dict] = []
    start = 0
    batch_size = 1000

    while True:
        result = (
            client.table("stores")
            .select("id,name")
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

    updated = 0
    for row in rows:
        flag = is_franchise(row["name"])
        if flag:
            client.table("stores").update({"is_franchise": True}).eq("id", row["id"]).execute()
            updated += 1

    logger.info(f"프랜차이즈 백필 완료: {updated}/{len(rows)}")
    return {"total": len(rows), "updated_franchise": updated}
