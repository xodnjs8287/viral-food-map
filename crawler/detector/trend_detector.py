import uuid
import logging
from datetime import datetime

from crawlers.naver_datalab import get_search_trend, calculate_acceleration
from crawlers.naver_search import get_blog_mention_count
from crawlers.instagram import get_hashtag_post_count
from crawlers.store_finder import find_stores_nationwide
from crawlers.image_finder import find_food_image
from detector.keyword_manager import get_flat_keywords
from database import upsert_trend, insert_stores, get_all_keywords
from config import settings

logger = logging.getLogger(__name__)


async def detect_trends():
    """메인 트렌드 탐지 로직"""
    logger.info("=== 트렌드 탐지 시작 ===")

    # 1. 모니터링 키워드 가져오기
    db_keywords = get_all_keywords()
    if db_keywords:
        keywords = [kw["keyword"] for kw in db_keywords]
    else:
        keywords = get_flat_keywords()

    logger.info(f"모니터링 키워드 {len(keywords)}개")

    # 2. 네이버 데이터랩에서 검색량 추이 조회
    search_data = await get_search_trend(keywords)

    # 3. 검색량 급등 후보 필터링
    candidates = []
    for keyword, data_points in search_data.items():
        acceleration = calculate_acceleration(data_points)
        if acceleration >= settings.TREND_THRESHOLD:
            candidates.append({
                "keyword": keyword,
                "acceleration": acceleration,
                "data_points": data_points,
            })
            logger.info(f"후보 발견: {keyword} (증가율 {acceleration:.1f}%)")

    if not candidates:
        logger.info("급등 키워드 없음")
        return

    # 4. 교차 검증
    confirmed = []
    for candidate in candidates:
        kw = candidate["keyword"]
        score = 0.0

        # 네이버 블로그 언급량
        blog_count = await get_blog_mention_count(kw)
        if blog_count > 1000:
            score += 30
        elif blog_count > 100:
            score += 15

        # 인스타그램 해시태그
        ig_count = await get_hashtag_post_count(kw)
        if ig_count is not None:
            if ig_count > 10000:
                score += 30
            elif ig_count > 1000:
                score += 15

        # 검색량 가속도 기반 점수
        acc = candidate["acceleration"]
        if acc > 500:
            score += 40
        elif acc > 300:
            score += 30
        elif acc > 200:
            score += 20
        elif acc > 100:
            score += 15
        elif acc > 30:
            score += 10

        candidate["score"] = score
        candidate["blog_count"] = blog_count
        candidate["ig_count"] = ig_count

        if score >= settings.TREND_SCORE_THRESHOLD:
            confirmed.append(candidate)
            logger.info(f"트렌드 확정: {kw} (점수 {score})")
        else:
            logger.info(f"트렌드 미달: {kw} (점수 {score})")

    # 5. 확정된 트렌드 저장 + 판매처 수집
    for trend in confirmed:
        kw = trend["keyword"]

        # 카테고리 추정
        db_kw = next(
            (k for k in (db_keywords or []) if k["keyword"] == kw),
            None,
        )
        category = db_kw["category"] if db_kw else "기타"

        trend_data = {
            "id": str(uuid.uuid4()),
            "name": kw,
            "category": category,
            "status": "rising" if trend["score"] >= 70 else "active",
            "detected_at": datetime.now().isoformat(),
            "peak_score": trend["score"],
            "search_volume_data": {
                p.get("period", ""): p.get("ratio", 0)
                for p in trend.get("data_points", [])
            },
            "description": None,
            "image_url": None,
        }

        # 대표 이미지 검색
        image_url = await find_food_image(kw, category=category)
        if image_url:
            trend_data["image_url"] = image_url
            logger.info(f"'{kw}' 대표 이미지 수집 완료")

        upsert_trend(trend_data)

        # 판매처 검색
        stores = await find_stores_nationwide(kw)
        if stores:
            store_records = [
                {**s, "id": str(uuid.uuid4()), "trend_id": trend_data["id"]}
                for s in stores
            ]
            insert_stores(store_records)
            logger.info(f"'{kw}' 판매처 {len(stores)}개 등록")

    logger.info(f"=== 트렌드 탐지 완료: {len(confirmed)}개 확정 ===")
