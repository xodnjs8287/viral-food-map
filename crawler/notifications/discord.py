import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)
DISCORD_MESSAGE_LIMIT = 2000


def _split_content(content: str) -> list[str]:
    if not content:
        return [""]

    chunks: list[str] = []
    current: list[str] = []
    current_length = 0

    for raw_line in content.splitlines():
        line = raw_line or " "
        line_length = len(line)

        if line_length > DISCORD_MESSAGE_LIMIT:
            if current:
                chunks.append("\n".join(current))
                current = []
                current_length = 0

            for start in range(0, line_length, DISCORD_MESSAGE_LIMIT):
                chunks.append(line[start : start + DISCORD_MESSAGE_LIMIT])
            continue

        additional = line_length + (1 if current else 0)
        if current and current_length + additional > DISCORD_MESSAGE_LIMIT:
            chunks.append("\n".join(current))
            current = [line]
            current_length = line_length
            continue

        current.append(line)
        current_length += additional

    if current:
        chunks.append("\n".join(current))

    return chunks


async def send_discord_message(content: str) -> bool:
    webhook_url = settings.DISCORD_WEBHOOK_URL.strip()
    if not webhook_url:
        return False

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            for chunk in _split_content(content):
                response = await client.post(
                    webhook_url,
                    json={"content": chunk},
                )
                response.raise_for_status()
        return True
    except Exception as exc:
        logger.error(f"디스코드 알림 전송 실패: {exc}")
        return False
