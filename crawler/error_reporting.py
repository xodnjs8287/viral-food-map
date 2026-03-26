import logging
import traceback
from collections import deque
from threading import Lock

from notifications.discord import send_discord_message

RECENT_LOG_CAPACITY = 50
RECENT_LOG_PREVIEW_COUNT = 20
DISCORD_SECTION_LIMIT = 1800

_recent_logs: deque[str] = deque(maxlen=RECENT_LOG_CAPACITY)
_recent_logs_lock = Lock()
_recent_logs_handler: logging.Handler | None = None
_REPORTED_FLAG = "_discord_reported"


class RecentLogsHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = self.format(record)
        except Exception:
            message = record.getMessage()

        with _recent_logs_lock:
            _recent_logs.append(message)


def install_recent_logs_handler() -> None:
    global _recent_logs_handler

    if _recent_logs_handler is not None:
        return

    handler = RecentLogsHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    logging.getLogger().addHandler(handler)
    _recent_logs_handler = handler


def _chunk_text(text: str, limit: int = DISCORD_SECTION_LIMIT) -> list[str]:
    if not text:
        return []

    chunks: list[str] = []
    current: list[str] = []
    current_length = 0

    for raw_line in text.splitlines():
        line = raw_line or " "
        line_length = len(line)

        if line_length > limit:
            if current:
                chunks.append("\n".join(current))
                current = []
                current_length = 0

            for start in range(0, line_length, limit):
                chunks.append(line[start : start + limit])
            continue

        additional = line_length + (1 if current else 0)
        if current and current_length + additional > limit:
            chunks.append("\n".join(current))
            current = [line]
            current_length = line_length
            continue

        current.append(line)
        current_length += additional

    if current:
        chunks.append("\n".join(current))

    return chunks


def _get_recent_logs(limit: int = RECENT_LOG_PREVIEW_COUNT) -> str:
    with _recent_logs_lock:
        lines = list(_recent_logs)[-limit:]
    return "\n".join(lines)


async def report_exception_to_discord(
    context: str,
    exc: Exception,
    *,
    details: dict[str, str] | None = None,
) -> None:
    if getattr(exc, _REPORTED_FLAG, False):
        return

    try:
        setattr(exc, _REPORTED_FLAG, True)
    except Exception:
        pass

    summary_lines = [
        "[크롤러 에러]",
        f"위치: {context}",
        f"예외: {exc.__class__.__name__}: {exc}",
    ]

    if details:
        for key, value in details.items():
            if value:
                summary_lines.append(f"{key}: {value}")

    await send_discord_message("\n".join(summary_lines))

    traceback_text = "".join(
        traceback.format_exception(type(exc), exc, exc.__traceback__)
    ).strip()
    for chunk in _chunk_text(traceback_text):
        await send_discord_message(f"[크롤러 에러 Traceback]\n{chunk}")

    recent_logs = _get_recent_logs()
    if recent_logs:
        for chunk in _chunk_text(recent_logs):
            await send_discord_message(f"[크롤러 최근 로그]\n{chunk}")
