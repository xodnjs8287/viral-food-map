from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth import AdminUser, require_admin_user
from crawlers.new_product_discovery import discover_new_product_source
from crawlers.new_products import preview_new_products_source, refresh_new_products_for_source
from database import get_new_product_source_by_source_key
from scheduler.jobs import (
    get_new_products_refresh_status,
    run_new_products_refresh_job,
)

router = APIRouter(prefix="/api/new-products", tags=["new-products"])


class AutoRegisterSourceRequest(BaseModel):
    brand: str = Field(min_length=1, max_length=80)
    source_type: Literal["franchise", "convenience"] = "franchise"


@router.post("/refresh")
async def refresh_new_products(_: AdminUser = Depends(require_admin_user)):
    summary = await run_new_products_refresh_job(trigger="manual")
    return {
        "message": "New products refresh completed",
        "summary": summary,
    }


@router.get("/status")
async def get_refresh_status():
    return get_new_products_refresh_status()


@router.post("/auto-register")
async def auto_register_new_product_source(
    request: AutoRegisterSourceRequest,
    _: AdminUser = Depends(require_admin_user),
):
    try:
        discovered = await discover_new_product_source(
            brand=request.brand,
            source_type=request.source_type,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    preview = await preview_new_products_source(discovered.source)
    summary = await refresh_new_products_for_source(
        discovered.source,
        trigger="manual-auto-register",
    )
    source_row = get_new_product_source_by_source_key(discovered.source.source_key)

    message = f"{discovered.source.brand} 소스를 자동 등록하고 수집했습니다."
    if preview["fetched_products"] <= 0:
        message = (
            f"{discovered.source.brand} 공식 소스를 등록했습니다. "
            "현재 수집된 신상품은 없지만, 다음 자동 수집부터 계속 추적합니다."
        )

    return {
        "message": message,
        "source": source_row,
        "discovery": {
            "matched_url": discovered.matched_url,
            "official_site_url": discovered.official_site_url,
            "confidence": discovered.confidence,
            "search_queries": discovered.search_queries,
            "notes": discovered.notes,
        },
        "preview": preview,
        "summary": summary,
    }
