import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from auth import AdminUser, require_admin_user
from database import get_client
from discord_reviews import ensure_report_review_message
from error_reporting import report_exception_to_discord
from franchise_checker import is_franchise

limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stores", tags=["stores"])


class ReportRequest(BaseModel):
    trend_id: str
    store_name: str
    address: str
    lat: float | None = None
    lng: float | None = None
    note: str | None = None


@router.get("")
async def list_stores(trend_id: str | None = None):
    """판매처 목록 (트렌드 필터 가능)"""
    query = get_client().table("stores").select("*")
    if trend_id:
        query = query.eq("trend_id", trend_id)
    return query.execute().data


@router.post("/report")
@limiter.limit("10/minute")
async def submit_report(request: Request, report: ReportRequest):
    """사용자 판매처 제보"""
    data = {
        "trend_id": report.trend_id,
        "store_name": report.store_name,
        "address": report.address,
        "lat": report.lat,
        "lng": report.lng,
        "note": report.note,
        "status": "pending",
    }
    result = get_client().table("reports").insert(data).execute()
    inserted_id = (result.data or [{}])[0].get("id") if result.data else None

    if inserted_id:
        report_row = (
            get_client()
            .table("reports")
            .select("*, trends(name)")
            .eq("id", inserted_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if report_row:
            try:
                await ensure_report_review_message(report_row[0])
            except Exception as exc:
                logger.exception("Discord report review sync failed for report=%s", inserted_id)
                await report_exception_to_discord(
                    "제보 디스코드 검토 메시지 동기화 실패",
                    exc,
                    details={
                        "report_id": str(inserted_id),
                        "trend_id": str(report.trend_id),
                        "store_name": report.store_name,
                    },
                )
    return {"message": "제보가 접수되었습니다", "data": result.data}


@router.post("/backfill-franchise")
async def backfill_franchise(_: AdminUser = Depends(require_admin_user)):
    """기존 매장의 is_franchise 필드를 일괄 업데이트 (배치)"""
    from franchise_checker import check_franchise_batch

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

    results = check_franchise_batch([r["name"] for r in rows])
    franchise_ids = [r["id"] for r in rows if results.get(r["name"], False)]

    # 배치 업데이트: 프랜차이즈인 것만 True로
    for i in range(0, len(franchise_ids), 50):
        chunk = franchise_ids[i : i + 50]
        client.table("stores").update({"is_franchise": True}).in_("id", chunk).execute()

    logger.info(f"프랜차이즈 백필 완료: {len(franchise_ids)}/{len(rows)}")
    return {"total": len(rows), "updated_franchise": len(franchise_ids)}
