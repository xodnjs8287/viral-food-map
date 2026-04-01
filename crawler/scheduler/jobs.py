from __future__ import annotations

import asyncio
import logging
import threading
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler

from config import settings
from crawlers.yomechu_places import refresh_recent_yomechu_ratings
from detector.keyword_discoverer import discover_keywords
from detector.store_updater import refresh_stores_for_active_trends
from detector.trend_detector import detect_trends
from error_reporting import report_exception_to_discord
from notifications import send_discord_message, send_push_notifications

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone=ZoneInfo(settings.SCHEDULER_TIMEZONE))
store_update_lock = threading.Lock()
yomechu_enrich_lock = threading.Lock()

MAX_DETAIL_LINES = 5
TREND_JOB_NAME = "트렌드 감지"
DISCOVERY_JOB_NAME = "키워드 발굴"
STORE_UPDATE_JOB_NAME = "판매처 갱신"
YOMECHU_JOB_NAME = "요메추 보강"

TREND_LABELS = {
    "keywords": "모니터링 키워드",
    "db_keywords": "DB 키워드",
    "seed_keywords": "시드 키워드",
    "candidates": "후보 키워드",
    "rank_candidates": "랭크 후보",
    "confirmed": "확정 트렌드",
    "stored_trends": "저장 트렌드",
    "stored_stores": "저장 판매처",
    "confirmed_keywords": "확정 키워드",
    "deactivated_trends": "비활성 트렌드",
    "ai_reviewed": "AI 검토 후보",
    "ai_accepted": "AI 통과 후보",
    "ai_calls_used": "AI 호출 사용",
    "ai_calls_remaining": "AI 호출 잔여",
    "alias_matches": "별칭 매칭",
    "budget_exhausted": "예산 소진",
    "canonicalized_keywords": "대표명 매핑",
    "ai_rejected_details": "AI 거절 상세",
    "ai_review_details": "AI 보류 상세",
    "ai_fallback_details": "AI fallback 상세",
}

DISCOVERY_LABELS = {
    "queries": "메타 쿼리",
    "collected_posts": "수집 포스트",
    "new_keywords": "신규 키워드",
    "keywords": "발굴 키워드",
    "ai_reviewed": "AI 검토 후보",
    "ai_accepted": "AI 통과 후보",
    "ai_calls_used": "AI 호출 사용",
    "ai_calls_remaining": "AI 호출 잔여",
    "alias_matches": "별칭 매칭",
    "budget_exhausted": "예산 소진",
    "canonicalized_keywords": "대표명 매핑",
    "ai_rejected_details": "AI 거절 상세",
    "ai_review_details": "AI 보류 상세",
    "ai_fallback_details": "AI fallback 상세",
}

STORE_UPDATE_LABELS = {
    "target_trends": "대상 트렌드",
    "processed_trends": "처리 트렌드",
    "added_stores": "추가 판매처",
    "changed_trends": "변경 발생 트렌드",
}

YOMECHU_LABELS = {
    "scanned": "검사 매장",
    "updated": "보강 건수",
}

JOB_LABELS = {
    TREND_JOB_NAME: TREND_LABELS,
    DISCOVERY_JOB_NAME: DISCOVERY_LABELS,
    STORE_UPDATE_JOB_NAME: STORE_UPDATE_LABELS,
    YOMECHU_JOB_NAME: YOMECHU_LABELS,
}


def _format_summary_lines(summary: dict, labels: dict[str, str]) -> list[str]:
    lines: list[str] = []
    for key, label in labels.items():
        value = summary.get(key)
        if value in (None, "", [], {}, False):
            continue
        if key.startswith("ai_") and key != "ai_calls_remaining" and value == 0:
            continue

        if isinstance(value, list):
            if key.endswith("_details"):
                visible_items = [str(item) for item in value[:MAX_DETAIL_LINES]]
                remaining = len(value) - len(visible_items)
                detail_lines = [f"{label}:"]
                detail_lines.extend(f"- {item}" for item in visible_items)
                if remaining > 0:
                    detail_lines.append(f"- 외 {remaining}건")
                lines.append("\n".join(detail_lines))
                continue

            formatted = ", ".join(str(item) for item in value[:MAX_DETAIL_LINES])
            if len(value) > MAX_DETAIL_LINES:
                formatted = f"{formatted}, 외 {len(value) - MAX_DETAIL_LINES}건"
        else:
            formatted = str(value)

        lines.append(f"{label}: {formatted}")

    return lines


def _build_job_message(
    job_name: str,
    trigger: str,
    status: str,
    summary: dict | None = None,
    error: Exception | None = None,
) -> str:
    lines = [f"[{job_name} {status}]", f"트리거: {trigger}"]

    if summary:
        lines.extend(_format_summary_lines(summary, JOB_LABELS.get(job_name, {})))

    if error is not None:
        lines.append(f"오류: {error.__class__.__name__}: {error}")

    return "\n".join(lines)


def _format_hour_minute(hour: int, minute: int) -> str:
    return f"{hour:02d}:{minute:02d}"


def get_scheduler_description() -> dict[str, str]:
    trend_hours = sorted(settings.TREND_DETECTION_SCHEDULE_HOURS)
    trend_schedule = (
        f"{_format_hour_minute(trend_hours[0], settings.TREND_DETECTION_SCHEDULE_MINUTE)}"
        f"~{_format_hour_minute(trend_hours[-1], settings.TREND_DETECTION_SCHEDULE_MINUTE)} 매시"
    )
    discovery_schedule = ", ".join(
        _format_hour_minute(hour, settings.DISCOVERY_SCHEDULE_MINUTE)
        for hour in sorted(settings.DISCOVERY_SCHEDULE_HOURS)
    )
    return {
        "timezone": settings.SCHEDULER_TIMEZONE,
        "trend_detection": trend_schedule,
        "keyword_discovery": discovery_schedule,
        "store_update_minutes": str(settings.STORE_UPDATE_INTERVAL_MINUTES),
        "daily_ai_limit": str(settings.AI_AUTOMATION_DAILY_LIMIT),
    }


async def run_trend_detection_job(trigger: str = "scheduler") -> dict:
    job_name = TREND_JOB_NAME
    logger.info("%s started (%s)", job_name, trigger)
    await send_discord_message(_build_job_message(job_name, trigger, "시작"))

    try:
        summary = await detect_trends(trigger=trigger)
        await send_discord_message(
            _build_job_message(job_name, trigger, "완료", summary=summary)
        )

        confirmed_keywords: list[str] = summary.get("confirmed_keywords", [])
        if confirmed_keywords:
            from database import get_client

            rows = (
                get_client()
                .table("trends")
                .select("id, name")
                .in_("name", confirmed_keywords)
                .execute()
                .data
            ) or []
            for row in rows:
                try:
                    send_push_notifications(row["name"], row["id"])
                except Exception as push_exc:
                    logger.warning(
                        "Push notification failed for %s: %s",
                        row["name"],
                        push_exc,
                    )

        return summary
    except Exception as exc:
        logger.exception("%s failed (%s)", job_name, trigger)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"trigger": trigger},
        )
        raise


async def run_keyword_discovery_job(trigger: str = "scheduler") -> dict:
    job_name = DISCOVERY_JOB_NAME
    logger.info("%s started (%s)", job_name, trigger)
    await send_discord_message(_build_job_message(job_name, trigger, "시작"))

    try:
        summary = await discover_keywords(trigger=trigger)
        await send_discord_message(
            _build_job_message(job_name, trigger, "완료", summary=summary)
        )
        return summary
    except Exception as exc:
        logger.exception("%s failed (%s)", job_name, trigger)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"trigger": trigger},
        )
        raise


async def run_store_update_job(trigger: str = "scheduler") -> dict:
    job_name = STORE_UPDATE_JOB_NAME
    if not store_update_lock.acquire(blocking=False):
        logger.warning("%s skipped because previous run is still active", job_name)
        return {
            "target_trends": 0,
            "processed_trends": 0,
            "added_stores": 0,
            "changed_trends": [],
            "skipped": True,
        }

    logger.info("%s started (%s)", job_name, trigger)

    try:
        summary = await refresh_stores_for_active_trends()
        if summary.get("added_stores", 0) > 0:
            await send_discord_message(
                _build_job_message(job_name, trigger, "완료", summary=summary)
            )
        return summary
    except Exception as exc:
        logger.exception("%s failed (%s)", job_name, trigger)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"trigger": trigger},
        )
        raise
    finally:
        store_update_lock.release()


async def run_yomechu_enrichment_job(trigger: str = "scheduler") -> dict:
    job_name = YOMECHU_JOB_NAME
    if not settings.YOMECHU_ENRICH_ENABLED:
        logger.info("%s skipped because it is disabled", job_name)
        return {"scanned": 0, "updated": 0, "skipped": True}

    if not yomechu_enrich_lock.acquire(blocking=False):
        logger.warning("%s skipped because previous run is still active", job_name)
        return {"scanned": 0, "updated": 0, "skipped": True}

    logger.info("%s started (%s)", job_name, trigger)
    try:
        summary = await refresh_recent_yomechu_ratings()
        if summary.get("updated", 0) > 0:
            await send_discord_message(
                _build_job_message(job_name, trigger, "완료", summary=summary)
            )
        return summary
    except Exception as exc:
        logger.exception("%s failed (%s)", job_name, trigger)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"trigger": trigger},
        )
        raise
    finally:
        yomechu_enrich_lock.release()


def run_trend_detection():
    asyncio.run(run_trend_detection_job(trigger="scheduler"))


def run_keyword_discovery():
    asyncio.run(run_keyword_discovery_job(trigger="scheduler"))


def run_store_update():
    asyncio.run(run_store_update_job(trigger="scheduler"))


def run_yomechu_enrichment():
    asyncio.run(run_yomechu_enrichment_job(trigger="scheduler"))


def start_scheduler():
    scheduler.add_job(
        run_trend_detection,
        "cron",
        hour=",".join(str(hour) for hour in sorted(settings.TREND_DETECTION_SCHEDULE_HOURS)),
        minute=settings.TREND_DETECTION_SCHEDULE_MINUTE,
        id="trend_detection",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        run_keyword_discovery,
        "cron",
        hour=",".join(str(hour) for hour in sorted(settings.DISCOVERY_SCHEDULE_HOURS)),
        minute=settings.DISCOVERY_SCHEDULE_MINUTE,
        id="keyword_discovery",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        run_store_update,
        "interval",
        minutes=settings.STORE_UPDATE_INTERVAL_MINUTES,
        id="store_update",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    if settings.YOMECHU_ENRICH_ENABLED:
        scheduler.add_job(
            run_yomechu_enrichment,
            "interval",
            hours=settings.YOMECHU_ENRICH_INTERVAL_HOURS,
            id="yomechu_enrichment",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
    scheduler.start()

    description = get_scheduler_description()
    logger.info(
        "Scheduler started: trend=%s, discovery=%s, store_update=%s min, ai_limit=%s/day, tz=%s",
        description["trend_detection"],
        description["keyword_discovery"],
        description["store_update_minutes"],
        description["daily_ai_limit"],
        description["timezone"],
    )


def stop_scheduler():
    if not scheduler.running:
        return
    scheduler.shutdown()
    logger.info("Scheduler stopped")
