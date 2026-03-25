from fastapi import APIRouter
from database import get_client
from detector.trend_detector import detect_trends
from detector.keyword_discoverer import discover_keywords

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
async def trigger_detection():
    """수동 트렌드 탐지 트리거"""
    await detect_trends()
    return {"message": "트렌드 탐지 완료"}


@router.post("/discover-keywords")
async def trigger_discovery():
    """수동 키워드 발굴 트리거"""
    new_keywords = await discover_keywords()
    return {
        "message": f"키워드 {len(new_keywords)}개 발견",
        "keywords": new_keywords,
    }
