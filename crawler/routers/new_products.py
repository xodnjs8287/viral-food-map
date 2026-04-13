import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth import AdminUser, require_admin_user
from crawlers.new_product_discovery import discover_new_product_source
from crawlers.new_products import preview_new_products_source, refresh_new_products_for_source
from database import get_new_product_source_by_source_key, upsert_new_product_source
from scheduler.jobs import (
    get_new_products_refresh_status,
    run_new_products_refresh_job,
)

router = APIRouter(prefix="/api/new-products", tags=["new-products"])
logger = logging.getLogger(__name__)


class AutoRegisterSourceRequest(BaseModel):
    brand: str = Field(min_length=1, max_length=80)
    source_type: Literal["franchise", "convenience"] = "franchise"


def _build_source_payload(source) -> dict:
    return {
        "source_key": source.source_key,
        "title": source.title,
        "brand": source.brand,
        "source_type": source.source_type,
        "channel": source.channel,
        "site_url": source.site_url,
        "crawl_url": source.crawl_url,
        "parser_type": source.parser_type,
        "parser_config": source.parser_config,
        "source_origin": source.source_origin,
        "discovery_metadata": source.discovery_metadata,
        "is_active": True,
    }


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

    source_row = (
        upsert_new_product_source(_build_source_payload(discovered.source))
        or get_new_product_source_by_source_key(discovered.source.source_key)
    )

    try:
        preview = await preview_new_products_source(discovered.source)
        summary = await refresh_new_products_for_source(
            discovered.source,
            trigger="manual-auto-register",
        )
        source_row = get_new_product_source_by_source_key(discovered.source.source_key)
    except Exception as exc:  # pragma: no cover - external crawl failures
        logger.exception(
            "Auto-register crawl failed for %s (%s)",
            discovered.source.source_key,
            discovered.source.brand,
        )
        return {
            "message": (
                f"{discovered.source.brand} 공식 소스를 등록했습니다. "
                "즉시 수집은 실패했지만 다음 자동 수집에서 다시 시도합니다."
            ),
            "source": source_row,
            "discovery": {
                "matched_url": discovered.matched_url,
                "official_site_url": discovered.official_site_url,
                "confidence": discovered.confidence,
                "search_queries": discovered.search_queries,
                "notes": discovered.notes,
            },
            "preview": {
                "fetched_products": 0,
                "preview_items": [],
            },
            "summary": None,
            "crawl_error": str(exc),
        }

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
