from __future__ import annotations

import logging
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

DISCORD_API_BASE_URL = "https://discord.com/api/v10"


class DiscordBotError(RuntimeError):
    pass


class DiscordBotNotFoundError(DiscordBotError):
    pass


def is_discord_review_enabled() -> bool:
    return bool(
        settings.DISCORD_REVIEW_ENABLED
        and settings.DISCORD_BOT_TOKEN.strip()
        and settings.DISCORD_REVIEW_CHANNEL_ID.strip()
    )


async def _request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    token = settings.DISCORD_BOT_TOKEN.strip()
    if not token:
        raise DiscordBotError("DISCORD_BOT_TOKEN이 설정되지 않았습니다.")

    url = f"{DISCORD_API_BASE_URL}{path}"
    headers = {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.request(method, url, headers=headers, json=json)
    except httpx.HTTPError as exc:
        raise DiscordBotError(f"Discord API 통신 실패 ({method} {path}): {exc}") from exc

    if response.status_code == 404:
        raise DiscordBotNotFoundError(f"Discord 리소스를 찾을 수 없습니다: {path}")

    if response.status_code >= 400:
        detail = response.text.strip() or f"status={response.status_code}"
        raise DiscordBotError(f"Discord API 요청 실패 ({method} {path}): {detail}")

    if response.content:
        return response.json()

    return {}


def _with_default_mentions(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        **payload,
        "allowed_mentions": {"parse": []},
    }


async def create_channel_message(
    channel_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return await _request(
        "POST",
        f"/channels/{channel_id}/messages",
        json=_with_default_mentions(payload),
    )


async def edit_channel_message(
    channel_id: str,
    message_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return await _request(
        "PATCH",
        f"/channels/{channel_id}/messages/{message_id}",
        json=_with_default_mentions(payload),
    )
