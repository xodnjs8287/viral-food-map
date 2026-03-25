import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from notifications import send_discord_message
from routers.trends import router as trends_router
from routers.stores import router as stores_router
from scheduler.jobs import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("서버 시작")
    start_scheduler()
    await send_discord_message(_build_startup_message())
    yield
    stop_scheduler()
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "viral-food-map-crawler"}
