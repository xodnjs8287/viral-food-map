import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    NAVER_CLIENT_ID: str = os.getenv("NAVER_CLIENT_ID", "")
    NAVER_CLIENT_SECRET: str = os.getenv("NAVER_CLIENT_SECRET", "")
    KAKAO_REST_API_KEY: str = os.getenv("KAKAO_REST_API_KEY", "")

    TREND_THRESHOLD: float = 30.0
    TREND_SCORE_THRESHOLD: float = 50.0
    CRAWL_INTERVAL_MINUTES: int = 30
    STORE_UPDATE_INTERVAL_HOURS: int = 2


settings = Settings()
