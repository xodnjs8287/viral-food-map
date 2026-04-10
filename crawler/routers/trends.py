from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from auth import AdminUser, require_admin_user
from database import get_client
from scheduler.jobs import (
    get_keyword_discovery_status,
    get_trend_detection_status,
    queue_keyword_discovery_job,
    queue_trend_detection_job,
)

router = APIRouter(prefix="/api/trends", tags=["trends"])


@router.get("")
async def list_trends():
    """활성 트렌드 목록 (판매처 수 포함)"""
    data = (
        get_client()
        .table("trends")
        .select("*, stores(count)")
        .in_("status", ["rising", "active"])
        .order("peak_score", desc=True)
        .execute()
        .data
    )
    return data


@router.get("/{trend_id}")
async def get_trend(trend_id: str):
    """트렌드 상세 + 판매처"""
    trend = (
        get_client()
        .table("trends")
        .select("*")
        .eq("id", trend_id)
        .single()
        .execute()
        .data
    )
    stores = (
        get_client()
        .table("stores")
        .select("*")
        .eq("trend_id", trend_id)
        .execute()
        .data
    )
    return {"trend": trend, "stores": stores}


@router.post("/detect")
async def trigger_detection(_: AdminUser = Depends(require_admin_user)):
    """수동 트렌드 탐지 트리거"""
    result = queue_trend_detection_job(trigger="manual")
    status_code = 202 if result["accepted"] else 200
    return JSONResponse(status_code=status_code, content=result)


@router.get("/detect/status")
async def get_detection_status():
    return get_trend_detection_status()


@router.post("/discover-keywords")
async def trigger_discovery(_: AdminUser = Depends(require_admin_user)):
    """수동 키워드 발굴 트리거"""
    result = queue_keyword_discovery_job(trigger="manual")
    status_code = 202 if result["accepted"] else 200
    return JSONResponse(status_code=status_code, content=result)


@router.get("/discover-keywords/status")
async def get_discovery_status():
    return get_keyword_discovery_status()
