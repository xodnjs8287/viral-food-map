import os
import sys

from dotenv import load_dotenv

load_dotenv()


def _env_csv_ints(name: str, default: str) -> list[int]:
    raw = os.getenv(name, default)
    values: list[int] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        values.append(int(item))
    return values


def _detect_app_env() -> str:
    explicit_env = (
        os.getenv("APP_ENV")
        or os.getenv("ENVIRONMENT")
        or os.getenv("SERVER_ENV")
        or os.getenv("PYTHON_ENV")
    )
    if explicit_env:
        return explicit_env.strip().lower()

    # Koyeb production containers expose KOYEB_* environment variables.
    if any(
        os.getenv(key)
        for key in (
            "KOYEB_SERVICE_NAME",
            "KOYEB_SERVICE_ID",
            "KOYEB_APP_NAME",
            "KOYEB_APP_ID",
        )
    ):
        return "production"

    if "--reload" in sys.argv:
        return "development"

    return "development"


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    NAVER_CLIENT_ID: str = os.getenv("NAVER_CLIENT_ID", "")
    NAVER_CLIENT_SECRET: str = os.getenv("NAVER_CLIENT_SECRET", "")
    KAKAO_REST_API_KEY: str = os.getenv("KAKAO_REST_API_KEY", "")
    DISCORD_WEBHOOK_URL: str = os.getenv("DISCORD_WEBHOOK_URL", "")
    APP_ENV: str = _detect_app_env()
    VAPID_PUBLIC_KEY: str = os.getenv("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY: str = os.getenv("VAPID_PRIVATE_KEY", "")
    VAPID_CONTACT: str = os.getenv("VAPID_CONTACT", "mailto:support@yozmeat.com")

    TREND_THRESHOLD: float = float(os.getenv("TREND_THRESHOLD", "20"))
    TREND_SCORE_THRESHOLD: float = float(os.getenv("TREND_SCORE_THRESHOLD", "25"))
    TREND_RISING_SCORE_THRESHOLD: float = float(
        os.getenv("TREND_RISING_SCORE_THRESHOLD", "40")
    )
    TREND_RISING_ACCELERATION_THRESHOLD: float = float(
        os.getenv("TREND_RISING_ACCELERATION_THRESHOLD", "100")
    )
    TREND_REFERENCE_KEYWORD: str = os.getenv("TREND_REFERENCE_KEYWORD", "마라탕")
    TREND_TOP_RANK_CANDIDATE_MAX: int = int(
        os.getenv("TREND_TOP_RANK_CANDIDATE_MAX", "10")
    )
    ACTIVE_TREND_TTL_HOURS: int = int(os.getenv("ACTIVE_TREND_TTL_HOURS", "24"))
    CRAWL_INTERVAL_MINUTES: int = int(os.getenv("CRAWL_INTERVAL_MINUTES", "30"))
    STORE_UPDATE_INTERVAL_MINUTES: int = int(
        os.getenv("STORE_UPDATE_INTERVAL_MINUTES", "60")
    )
    DISCOVERY_INTERVAL_HOURS: int = int(os.getenv("DISCOVERY_INTERVAL_HOURS", "1"))
    DISCOVERY_MIN_FREQUENCY: int = int(os.getenv("DISCOVERY_MIN_FREQUENCY", "3"))
    DISCOVERY_MAX_NEW_KEYWORDS: int = int(
        os.getenv("DISCOVERY_MAX_NEW_KEYWORDS", "10")
    )
    AI_AUTOMATION_DAILY_LIMIT: int = int(
        os.getenv("AI_AUTOMATION_DAILY_LIMIT", "20")
    )
    SCHEDULER_TIMEZONE: str = os.getenv("SCHEDULER_TIMEZONE", "Asia/Seoul")
    TREND_DETECTION_SCHEDULE_HOURS: list[int] = _env_csv_ints(
        "TREND_DETECTION_SCHEDULE_HOURS",
        "7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22",
    )
    TREND_DETECTION_SCHEDULE_MINUTE: int = int(
        os.getenv("TREND_DETECTION_SCHEDULE_MINUTE", "0")
    )
    DISCOVERY_SCHEDULE_HOURS: list[int] = _env_csv_ints(
        "DISCOVERY_SCHEDULE_HOURS",
        "0,6,12,18",
    )
    DISCOVERY_SCHEDULE_MINUTE: int = int(
        os.getenv("DISCOVERY_SCHEDULE_MINUTE", "30")
    )
    YOMECHU_ENRICH_INTERVAL_HOURS: int = int(
        os.getenv("YOMECHU_ENRICH_INTERVAL_HOURS", "4")
    )
    YOMECHU_ENRICH_BATCH_SIZE: int = int(
        os.getenv("YOMECHU_ENRICH_BATCH_SIZE", "100")
    )
    YOMECHU_ENRICH_ENABLED: bool = _env_bool(
        "YOMECHU_ENRICH_ENABLED",
        default=False,
    )
    AI_REVIEW_API_URL: str = os.getenv(
        "AI_REVIEW_API_URL",
        "https://api.openai.com/v1/chat/completions",
    )
    AI_REVIEW_API_KEY: str = os.getenv("AI_REVIEW_API_KEY", "")
    AI_REVIEW_MODEL: str = os.getenv("AI_REVIEW_MODEL", "")
    AI_REVIEW_ENABLED: bool = _env_bool(
        "AI_REVIEW_ENABLED",
        default=bool(
            os.getenv("AI_REVIEW_API_KEY", "").strip()
            and os.getenv("AI_REVIEW_MODEL", "").strip()
        ),
    )
    AI_REVIEW_TIMEOUT_SECONDS: int = int(
        os.getenv("AI_REVIEW_TIMEOUT_SECONDS", "15")
    )
    AI_REVIEW_MIN_CONFIDENCE: float = float(
        os.getenv("AI_REVIEW_MIN_CONFIDENCE", "0.7")
    )
    AI_REVIEW_MAX_EVIDENCE_SNIPPETS: int = int(
        os.getenv("AI_REVIEW_MAX_EVIDENCE_SNIPPETS", "4")
    )
    AI_DISCOVERY_REVIEW_MAX_CANDIDATES: int = int(
        os.getenv(
            "AI_DISCOVERY_REVIEW_MAX_CANDIDATES",
            str(max(int(os.getenv("DISCOVERY_MAX_NEW_KEYWORDS", "10")), 10)),
        )
    )


settings = Settings()
