from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from auth import AdminUser, require_admin_user
from config import settings
from discord_reviews import (
    INTERACTION_RESPONSE_TYPE_PONG,
    INTERACTION_TYPE_PING,
    build_ephemeral_response,
    process_interaction,
    sync_pending_review_messages,
    verify_interaction_signature,
)

router = APIRouter(prefix="/api/discord", tags=["discord"])


@router.post("/interactions")
async def handle_discord_interactions(
    request: Request,
    x_signature_ed25519: str | None = Header(default=None),
    x_signature_timestamp: str | None = Header(default=None),
):
    raw_body = await request.body()
    if not verify_interaction_signature(
        raw_body,
        signature=x_signature_ed25519 or "",
        timestamp=x_signature_timestamp or "",
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Discord signature",
        )

    interaction = await request.json()
    if int(interaction.get("type", 0)) == INTERACTION_TYPE_PING:
        return JSONResponse({"type": INTERACTION_RESPONSE_TYPE_PONG})

    if not settings.DISCORD_REVIEW_ENABLED:
        return JSONResponse(build_ephemeral_response("디스코드 검토 기능이 비활성화되어 있습니다."))

    result = await process_interaction(interaction)
    return JSONResponse(build_ephemeral_response(result.message))


@router.post("/review-sync")
async def sync_discord_review_messages(_: AdminUser = Depends(require_admin_user)):
    counts = await sync_pending_review_messages()
    return {
        "message": "대기 중인 디스코드 검토 메시지를 동기화했습니다.",
        "counts": counts,
    }
