from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from config import settings
from database import count_ai_automation_usage, insert_ai_automation_usage

logger = logging.getLogger(__name__)
_fallback_lock = threading.Lock()
_fallback_usage_by_day: dict[str, int] = {}


def _today_key() -> str:
    return datetime.now(ZoneInfo(settings.SCHEDULER_TIMEZONE)).date().isoformat()


def _fallback_count(day_key: str) -> int:
    with _fallback_lock:
        return _fallback_usage_by_day.get(day_key, 0)


def _fallback_reserve(day_key: str) -> int:
    with _fallback_lock:
        current = _fallback_usage_by_day.get(day_key, 0) + 1
        _fallback_usage_by_day[day_key] = current
        return current


@dataclass(slots=True)
class AIBudgetReservation:
    allowed: bool
    counted: bool
    used_today: int
    remaining_today: int
    reason: str | None = None


def reserve_automation_ai_call(job_name: str, trigger: str) -> AIBudgetReservation:
    day_key = _today_key()
    try:
        used_today = count_ai_automation_usage(day_key)
        use_fallback = False
    except Exception:
        used_today = _fallback_count(day_key)
        use_fallback = True

    if trigger != "scheduler":
        return AIBudgetReservation(
            allowed=True,
            counted=False,
            used_today=used_today,
            remaining_today=max(settings.AI_AUTOMATION_DAILY_LIMIT - used_today, 0),
            reason="non_scheduler_trigger",
        )

    if used_today >= settings.AI_AUTOMATION_DAILY_LIMIT:
        logger.info(
            "AI automation budget exhausted for %s: %s/%s",
            job_name,
            used_today,
            settings.AI_AUTOMATION_DAILY_LIMIT,
        )
        return AIBudgetReservation(
            allowed=False,
            counted=False,
            used_today=used_today,
            remaining_today=0,
            reason="daily_limit_reached",
        )

    if use_fallback:
        used_today = _fallback_reserve(day_key)
    else:
        try:
            insert_ai_automation_usage(
                {
                    "usage_date": day_key,
                    "job_name": job_name,
                    "trigger": trigger,
                }
            )
            used_today += 1
        except Exception:
            used_today = _fallback_reserve(day_key)

    return AIBudgetReservation(
        allowed=True,
        counted=True,
        used_today=used_today,
        remaining_today=max(settings.AI_AUTOMATION_DAILY_LIMIT - used_today, 0),
    )


def get_automation_ai_budget_snapshot() -> tuple[int, int]:
    day_key = _today_key()
    try:
        used_today = count_ai_automation_usage(day_key)
    except Exception:
        used_today = _fallback_count(day_key)
    remaining_today = max(settings.AI_AUTOMATION_DAILY_LIMIT - used_today, 0)
    return used_today, remaining_today
