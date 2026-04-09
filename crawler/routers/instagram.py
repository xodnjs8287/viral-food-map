from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from auth import AdminUser, require_admin_user
from database import list_instagram_feed_runs
from scheduler.jobs import run_instagram_feed_job

router = APIRouter(prefix="/api/instagram", tags=["instagram"])


class FeedPublishRequest(BaseModel):
    dry_run: bool = False
    force_retry: bool = False


@router.post("/feed/publish")
async def publish_instagram_feed(
    request: FeedPublishRequest,
    _: AdminUser = Depends(require_admin_user),
):
    summary = await run_instagram_feed_job(
        trigger="manual",
        dry_run=request.dry_run,
        force_retry=request.force_retry,
    )
    return {
        "message": "Instagram feed publish request completed",
        "summary": summary,
    }


@router.get("/feed/runs")
async def get_instagram_feed_runs(
    limit: int = Query(default=30, ge=1, le=100),
):
    return {
        "runs": list_instagram_feed_runs(limit=limit),
    }
