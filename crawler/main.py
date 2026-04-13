from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
from error_reporting import install_recent_logs_handler, report_exception_to_discord
from notifications import send_discord_message
from routers.instagram import router as instagram_router
from routers.new_products import router as new_products_router
from routers.stores import router as stores_router
from routers.trends import router as trends_router
from routers.yomechu import router as yomechu_router
from scheduler.jobs import (
    get_scheduler_description,
    run_new_products_refresh_job,
    run_yomechu_enrichment_job,
    start_scheduler,
    stop_scheduler,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
install_recent_logs_handler()
logger = logging.getLogger(__name__)


def _build_startup_message() -> str:
    schedule = get_scheduler_description()
    instagram_line = (
        f"인스타 피드: 매일 {schedule['instagram_feed_schedule']}"
        if settings.INSTAGRAM_POSTING_ENABLED
        else "인스타 피드: 비활성화"
    )
    new_products_line = (
        f"신상 수집: {settings.NEW_PRODUCTS_INTERVAL_HOURS}시간 간격"
        if settings.NEW_PRODUCTS_ENABLED
        else "신상 수집: 비활성화"
    )
    yomechu_line = (
        f"요메추 보강 주기: {settings.YOMECHU_ENRICH_INTERVAL_HOURS}시간"
        if settings.YOMECHU_ENRICH_ENABLED
        else "요메추 보강 배치: 비활성화"
    )
    return "\n".join(
        [
            "[크롤러 시작]",
            f"시간대: {schedule['timezone']}",
            f"트렌드 감지: {schedule['trend_detection']}",
            f"키워드 발굴: {schedule['keyword_discovery']}",
            f"자동 AI 한도: {schedule['daily_ai_limit']}회/일",
            f"판매처 갱신: {schedule['store_update_minutes']}분 간격",
            instagram_line,
            new_products_line,
            yomechu_line,
        ]
    )


def _handle_background_task_result(task: asyncio.Task):
    try:
        task.result()
    except asyncio.CancelledError:
        logger.info("Startup background task cancelled")
    except Exception:
        logger.exception("Startup background task failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Server starting")
    startup_yomechu_enrich: asyncio.Task | None = None
    startup_new_products_refresh: asyncio.Task | None = None

    try:
        start_scheduler()
        await send_discord_message(_build_startup_message())

        if settings.NEW_PRODUCTS_ENABLED:
            startup_new_products_refresh = asyncio.create_task(
                run_new_products_refresh_job(trigger="startup")
            )
            startup_new_products_refresh.add_done_callback(_handle_background_task_result)

        if settings.YOMECHU_ENRICH_ENABLED:
            startup_yomechu_enrich = asyncio.create_task(
                run_yomechu_enrichment_job(trigger="startup")
            )
            startup_yomechu_enrich.add_done_callback(_handle_background_task_result)
        yield
    except Exception as exc:
        logger.exception("Server lifecycle failed")
        await report_exception_to_discord("서버 라이프사이클 실패", exc)
        raise
    finally:
        try:
            if startup_new_products_refresh and not startup_new_products_refresh.done():
                startup_new_products_refresh.cancel()
            if startup_yomechu_enrich and not startup_yomechu_enrich.done():
                startup_yomechu_enrich.cancel()
            stop_scheduler()
        except Exception as exc:
            logger.exception("Server shutdown failed")
            await report_exception_to_discord("서버 종료 처리 실패", exc)
            raise
        logger.info("Server stopped")


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="요즘뭐먹 API",
    description="바이럴 음식 트렌드를 감지하고 판매처를 수집하는 백엔드",
    version="0.3.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://www.yozmeat.com",
        "https://yozmeat.com",
        "http://localhost:3000",
    ],
    allow_origin_regex=(
        r"https://([a-z0-9-]+\.)*yozmeat\.com"
        r"|https://([a-z0-9-]+\.)*vercel\.app"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trends_router)
app.include_router(stores_router)
app.include_router(instagram_router)
app.include_router(new_products_router)
app.include_router(yomechu_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception while processing %s %s", request.method, request.url.path)
    await report_exception_to_discord(
        "API 요청 처리 실패",
        exc,
        details={
            "method": request.method,
            "path": request.url.path,
            "query": request.url.query,
        },
    )
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.get("/health")
async def health():
    schedule = get_scheduler_description()
    return {
        "status": "ok",
        "service": "viral-food-map-crawler",
        "yomechu_enrich_enabled": settings.YOMECHU_ENRICH_ENABLED,
        "scheduler_timezone": schedule["timezone"],
        "daily_ai_limit": int(schedule["daily_ai_limit"]),
        "trend_detection_schedule": schedule["trend_detection"],
        "keyword_discovery_schedule": schedule["keyword_discovery"],
        "store_update_interval_minutes": int(schedule["store_update_minutes"]),
        "new_products_enabled": settings.NEW_PRODUCTS_ENABLED,
        "new_products_interval_hours": int(schedule["new_products_interval_hours"]),
        "instagram_posting_enabled": settings.INSTAGRAM_POSTING_ENABLED,
        "instagram_feed_schedule": schedule["instagram_feed_schedule"],
        "instagram_media_bucket": settings.INSTAGRAM_MEDIA_BUCKET,
    }
