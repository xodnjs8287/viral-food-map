import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from error_reporting import install_recent_logs_handler, report_exception_to_discord
from notifications import send_discord_message
from routers.trends import router as trends_router
from routers.stores import router as stores_router
from scheduler.jobs import run_store_update_job, start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
install_recent_logs_handler()
logger = logging.getLogger(__name__)


def _build_startup_message() -> str:
    return "\n".join(
        [
            "[크롤러 올라옴]",
            f"트렌드 탐지 주기: {settings.CRAWL_INTERVAL_MINUTES}분",
            f"판매처 갱신 주기: {settings.STORE_UPDATE_INTERVAL_MINUTES}분",
            f"키워드 발굴 주기: {settings.DISCOVERY_INTERVAL_HOURS}시간",
        ]
    )


def _handle_background_task_result(task: asyncio.Task):
    try:
        task.result()
    except asyncio.CancelledError:
        logger.info("시작 직후 판매처 갱신 작업 취소")
    except Exception:
        logger.exception("시작 직후 판매처 갱신 작업 실패")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("서버 시작")
    startup_store_update: asyncio.Task | None = None

    try:
        start_scheduler()
        await send_discord_message(_build_startup_message())
        startup_store_update = asyncio.create_task(run_store_update_job(trigger="startup"))
        startup_store_update.add_done_callback(_handle_background_task_result)
        yield
    except Exception as exc:
        logger.exception("크롤러 라이프사이클 처리 실패")
        await report_exception_to_discord("크롤러 라이프사이클 처리 실패", exc)
        raise
    finally:
        try:
            if startup_store_update and not startup_store_update.done():
                startup_store_update.cancel()
            stop_scheduler()
        except Exception as exc:
            logger.exception("크롤러 종료 처리 실패")
            await report_exception_to_discord("크롤러 종료 처리 실패", exc)
            raise
        logger.info("서버 종료")


app = FastAPI(
    title="요즘뭐먹 API",
    description="바이럴 음식 트렌드 탐지 크롤러",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trends_router)
app.include_router(stores_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("요청 처리 중 예외 발생: %s %s", request.method, request.url.path)
    await report_exception_to_discord(
        "API 요청 처리 실패",
        exc,
        details={
            "메서드": request.method,
            "경로": request.url.path,
            "쿼리": request.url.query,
        },
    )
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.get("/health")
async def health():
    return {"status": "ok", "service": "viral-food-map-crawler"}
