from __future__ import annotations

import asyncio
import logging
import threading

from apscheduler.schedulers.background import BackgroundScheduler

from config import settings
from crawlers.yomechu_places import refresh_recent_yomechu_ratings
from detector.keyword_discoverer import discover_keywords
from detector.store_updater import refresh_stores_for_active_trends
from detector.trend_detector import detect_trends
from error_reporting import report_exception_to_discord
from notifications import send_discord_message, send_push_notifications

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()
store_update_lock = threading.Lock()
yomechu_enrich_lock = threading.Lock()

TREND_LABELS = {
    "keywords": "모니터링 키워드",
    "candidates": "급등 후보",
    "confirmed": "확정 트렌드",
    "stored_trends": "저장 트렌드",
    "stored_stores": "등록 판매처",
    "confirmed_keywords": "확정 키워드",
    "ai_reviewed": "AI 심사 수",
    "ai_rejected_keywords": "AI 거절 키워드",
    "ai_review_keywords": "AI 보류 키워드",
    "ai_fallback_keywords": "AI fallback 키워드",
}

DISCOVERY_LABELS = {
    "queries": "탐색 쿼리",
    "collected_posts": "수집 포스트",
    "new_keywords": "신규 키워드",
    "keywords": "발굴 키워드",
    "ai_reviewed": "AI 심사 수",
    "ai_skipped_keywords": "AI 제외 키워드",
    "ai_fallback_keywords": "AI fallback 키워드",
}

STORE_UPDATE_LABELS = {
    "target_trends": "대상 트렌드",
    "processed_trends": "처리 트렌드",
    "added_stores": "추가 판매처",
    "changed_trends": "추가 발생 트렌드",
}

YOMECHU_LABELS = {
    "scanned": "검사 장소",
    "updated": "평점 갱신",
}

JOB_LABELS = {
    "트렌드 감지": TREND_LABELS,
    "키워드 발굴": DISCOVERY_LABELS,
    "판매처 갱신": STORE_UPDATE_LABELS,
    "요메추 보강": YOMECHU_LABELS,
}


def _format_summary_lines(summary: dict, labels: dict[str, str]) -> list[str]:
    lines: list[str] = []
    for key, label in labels.items():
        value = summary.get(key)
        if value in (None, "", [], {}):
            continue
        if isinstance(value, list):
            formatted = ", ".join(str(item) for item in value)
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


async def run_trend_detection_job(trigger: str = "scheduler") -> dict:
    job_name = "트렌드 감지"
    logger.info("%s 트리거 %s 시작", trigger, job_name)
    await send_discord_message(_build_job_message(job_name, trigger, "시작"))

    try:
        summary = await detect_trends()
        await send_discord_message(
            _build_job_message(job_name, trigger, "완료", summary=summary)
        )

        # 새로 확정된 트렌드가 있으면 웹 푸시 발송
        new_keywords: list[str] = summary.get("confirmed_keywords", [])
        if new_keywords:
            from database import get_client
            rows = (
                get_client()
                .table("trends")
                .select("id, name")
                .in_("name", new_keywords)
                .execute()
                .data
            ) or []
            for row in rows:
                try:
                    send_push_notifications(row["name"], row["id"])
                except Exception as push_exc:
                    logger.warning("웹 푸시 발송 오류 (%s): %s", row["name"], push_exc)

        return summary
    except Exception as exc:
        logger.exception("%s 트리거 %s 실패", trigger, job_name)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"트리거": trigger},
        )
        raise


async def run_keyword_discovery_job(trigger: str = "scheduler") -> dict:
    job_name = "키워드 발굴"
    logger.info("%s 트리거 %s 시작", trigger, job_name)
    await send_discord_message(_build_job_message(job_name, trigger, "시작"))

    try:
        summary = await discover_keywords()
        await send_discord_message(
            _build_job_message(job_name, trigger, "완료", summary=summary)
        )
        return summary
    except Exception as exc:
        logger.exception("%s 트리거 %s 실패", trigger, job_name)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"트리거": trigger},
        )
        raise


async def run_startup_bootstrap_job() -> None:
    """Run keyword discovery before the first startup trend detection."""
    try:
        await run_keyword_discovery_job(trigger="startup")
    except Exception:
        logger.info(
            "startup keyword discovery failed; continuing with trend detection fallback"
        )

    await run_trend_detection_job(trigger="startup")


async def run_store_update_job(trigger: str = "scheduler") -> dict:
    job_name = "판매처 갱신"
    if not store_update_lock.acquire(blocking=False):
        logger.warning("%s 트리거 %s 스킵: 이전 작업이 아직 실행 중", trigger, job_name)
        return {
            "target_trends": 0,
            "processed_trends": 0,
            "added_stores": 0,
            "changed_trends": [],
            "skipped": True,
        }

    logger.info("%s 트리거 %s 시작", trigger, job_name)

    try:
        summary = await refresh_stores_for_active_trends()
        if summary.get("added_stores", 0) > 0:
            await send_discord_message(
                _build_job_message(job_name, trigger, "완료", summary=summary)
            )
        return summary
    except Exception as exc:
        logger.exception("%s 트리거 %s 실패", trigger, job_name)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"트리거": trigger},
        )
        raise
    finally:
        store_update_lock.release()


async def run_yomechu_enrichment_job(trigger: str = "scheduler") -> dict:
    job_name = "요메추 보강"
    if not yomechu_enrich_lock.acquire(blocking=False):
        logger.warning("%s 트리거 %s 스킵: 이전 작업이 아직 실행 중", trigger, job_name)
        return {"scanned": 0, "updated": 0, "skipped": True}

    logger.info("%s 트리거 %s 시작", trigger, job_name)
    try:
        summary = await refresh_recent_yomechu_ratings()
        if summary.get("updated", 0) > 0:
            await send_discord_message(
                _build_job_message(job_name, trigger, "완료", summary=summary)
            )
        return summary
    except Exception as exc:
        logger.exception("%s 트리거 %s 실패", trigger, job_name)
        await report_exception_to_discord(
            f"{job_name} 실패",
            exc,
            details={"트리거": trigger},
        )
        raise
    finally:
        yomechu_enrich_lock.release()


def run_trend_detection():
    logger.info("스케줄러 트렌드 감지 시작")
    asyncio.run(run_trend_detection_job())


def run_keyword_discovery():
    logger.info("스케줄러 키워드 발굴 시작")
    asyncio.run(run_keyword_discovery_job())


def run_store_update():
    logger.info("스케줄러 판매처 갱신 시작")
    asyncio.run(run_store_update_job())


def run_yomechu_enrichment():
    logger.info("스케줄러 요메추 평점 보강 시작")
    asyncio.run(run_yomechu_enrichment_job())


def start_scheduler():
    scheduler.add_job(
        run_trend_detection,
        "interval",
        minutes=settings.CRAWL_INTERVAL_MINUTES,
        id="trend_detection",
        replace_existing=True,
    )
    scheduler.add_job(
        run_keyword_discovery,
        "interval",
        hours=settings.DISCOVERY_INTERVAL_HOURS,
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
    logger.info(
        "스케줄러 시작: 트렌드 감지 %s분 / 판매처 갱신 %s분 / 키워드 발굴 %s시간 / 요메추 보강 %s시간",
        settings.CRAWL_INTERVAL_MINUTES,
        settings.STORE_UPDATE_INTERVAL_MINUTES,
        settings.DISCOVERY_INTERVAL_HOURS,
        settings.YOMECHU_ENRICH_INTERVAL_HOURS,
    )


def stop_scheduler():
    if not scheduler.running:
        return
    scheduler.shutdown()
    logger.info("스케줄러 중지")
