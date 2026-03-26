from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from crawlers.yomechu_places import CATEGORY_CONFIG, YomechuNoResultsError, spin_yomechu

router = APIRouter(prefix="/api/yomechu", tags=["yomechu"])


class SpinRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    radius_m: int = Field(..., ge=100, le=3000)
    category_slug: str = Field(..., min_length=1)
    session_id: str | None = Field(default=None, max_length=120)


class FeedbackRequest(BaseModel):
    spin_id: str | None = None
    place_id: str | None = None
    session_id: str | None = Field(default=None, max_length=120)
    event_type: Literal["reroll", "open", "close"]
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/spin")
async def create_spin(payload: SpinRequest):
    if payload.category_slug not in CATEGORY_CONFIG:
        raise HTTPException(status_code=400, detail="Unsupported category")

    try:
        return await spin_yomechu(
            lat=payload.lat,
            lng=payload.lng,
            radius_m=payload.radius_m,
            category_slug=payload.category_slug,
            session_id=payload.session_id,
        )
    except YomechuNoResultsError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/feedback")
async def create_feedback(payload: FeedbackRequest):
    del payload
    return {"ok": True}
