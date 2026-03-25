import asyncio
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from detector.trend_detector import detect_trends
from detector.keyword_discoverer import discover_keywords
from config import settings

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


def run_trend_detection():
    """트렌드 탐지 작업 실행"""
    logger.info("스케줄: 트렌드 탐지 시작")
    asyncio.run(detect_trends())


def run_keyword_discovery():
    """키워드 자동 발굴 작업 실행"""
    logger.info("스케줄: 키워드 발굴 시작")
    asyncio.run(discover_keywords())


def start_scheduler():
    """스케줄러 시작"""
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
    )

    scheduler.start()
    logger.info(
        f"스케줄러 시작: 트렌드 탐지 {settings.CRAWL_INTERVAL_MINUTES}분, "
        f"키워드 발굴 {settings.DISCOVERY_INTERVAL_HOURS}시간 간격"
    )


def stop_scheduler():
    """스케줄러 중지"""
    scheduler.shutdown()
    logger.info("스케줄러 중지")
