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

    # DB에서 오늘 사용량 조회 (1회 재시도)
    db_available = True
    used_today = 0
    for attempt in range(2):
        try:
            used_today = count_ai_automation_usage(day_key)
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("AI budget DB check failed, retrying: %s", exc)
            else:
                logger.error("AI budget DB check unavailable after retry: %s", exc)
                db_available = False
                used_today = _fallback_count(day_key)

    if trigger != "scheduler":
        return AIBudgetReservation(
            allowed=True,
            counted=False,
            used_today=used_today,
            remaining_today=max(settings.AI_AUTOMATION_DAILY_LIMIT - used_today, 0),
            reason="non_scheduler_trigger",
        )

    # 스케줄러 트리거: DB 조회 실패 시 예산 초과 방지를 위해 차단
    if not db_available:
        logger.warning(
            "AI automation blocked for %s: budget DB unavailable, using local fallback count %s",
            job_name,
            used_today,
        )
        return AIBudgetReservation(
            allowed=False,
            counted=False,
            used_today=used_today,
            remaining_today=max(settings.AI_AUTOMATION_DAILY_LIMIT - used_today, 0),
            reason="budget_check_unavailable",
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

    # 사용량 DB 기록 (1회 재시도, 실패 시 로컬 카운터 fallback)
    for attempt in range(2):
        try:
            insert_ai_automation_usage(
                {
                    "usage_date": day_key,
                    "job_name": job_name,
                    "trigger": trigger,
                }
            )
            used_today += 1
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("AI budget DB insert failed, retrying: %s", exc)
            else:
                logger.error("AI budget DB insert unavailable after retry, using local fallback: %s", exc)
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
