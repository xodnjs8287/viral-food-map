import re
import logging
from collections import Counter

import httpx
from kiwipiepy import Kiwi

from config import settings
from database import get_all_keywords, insert_keywords
from detector.keyword_manager import get_flat_keywords

logger = logging.getLogger(__name__)

NAVER_BLOG_URL = "https://openapi.naver.com/v1/search/blog"

META_QUERIES = [
    "요즘 뜨는 디저트",
    "핫한 음식 트렌드",
    "신상 카페 메뉴",
    "요즘 유행하는 간식",
    "SNS 인기 음식",
    "요즘 핫한 맛집 메뉴",
    "편의점 신상",
    "인스타 감성 디저트",
    "2026 음식 트렌드",
    "요즘 뭐 먹지",
]

STOPWORDS = {
    "서울", "카페", "맛집", "후기", "추천", "사진", "가격", "위치", "영업",
    "시간", "메뉴", "주문", "매장", "오픈", "블로그", "리뷰", "방문", "주소",
    "사람", "요즘", "정말", "최근", "느낌", "이번", "올해", "지역", "근처",
    "소개", "정보", "인기", "세트", "이벤트", "할인", "택배", "배달", "주차",
    "예약", "분위기", "인테리어", "테이블", "좌석", "직원", "서비스", "재방문",
    "가게", "장소", "동네", "트렌드", "유행", "포장", "부산", "대구", "인천",
    "대전", "광주", "수원", "성남", "강남", "홍대", "건대", "이태원", "합정",
    "역삼", "판교", "종로", "명동", "신촌", "마포", "일상", "데이트", "모임",
    "친구", "가족", "혼밥", "혼술", "한국", "일본", "중국", "미국",
}

FOOD_CONTEXT_WORDS = {"맛", "먹", "디저트", "카페", "빵", "케이크", "음료", "간식", "맛있", "달콤", "식감", "쫀득", "바삭"}

CATEGORY_SIGNALS = {
    "디저트": {"디저트", "케이크", "빵", "쿠키", "마카롱", "달콤", "쫀득", "바삭", "크림", "초콜릿"},
    "음료": {"음료", "라떼", "커피", "차", "주스", "스무디", "아이스", "카페인", "시럽"},
    "식사": {"밥", "면", "국", "탕", "찌개", "고기", "파스타", "볶음", "구이", "덮밥"},
    "간식": {"간식", "과자", "스낵", "떡", "호떡", "거리", "포차", "분식", "튀김"},
}

_kiwi: Kiwi | None = None


def get_kiwi() -> Kiwi:
    global _kiwi
    if _kiwi is None:
        _kiwi = Kiwi()
    return _kiwi


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


async def search_blogs(query: str, display: int = 30) -> list[dict]:
    """네이버 블로그 API로 포스트 검색"""
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                NAVER_BLOG_URL,
                params={"query": query, "display": display, "sort": "date"},
                headers=headers,
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json().get("items", [])
    except Exception as e:
        logger.error(f"블로그 검색 실패 ({query}): {e}")
        return []


def extract_nouns(text: str) -> list[str]:
    """kiwipiepy로 명사 추출 (NNG, NNP)"""
    kiwi = get_kiwi()
    result = kiwi.analyze(text)
    nouns = []
    for token, tag, *_ in result[0][0]:
        if tag in ("NNG", "NNP") and 2 <= len(token) <= 10:
            nouns.append(token)
    return nouns


def classify_category(noun: str, context_nouns: Counter) -> str:
    """주변 명사 빈도 기반 카테고리 추정"""
    scores = {}
    for category, signals in CATEGORY_SIGNALS.items():
        scores[category] = sum(context_nouns.get(s, 0) for s in signals)
    best = max(scores, key=scores.get)
    if scores[best] > 0:
        return best
    return "기타"


async def discover_keywords() -> list[dict]:
    """블로그 기반 키워드 자동 발굴 파이프라인"""
    logger.info("키워드 발굴 시작")

    # 1. 블로그 검색으로 텍스트 수집
    all_texts = []
    for query in META_QUERIES:
        items = await search_blogs(query)
        for item in items:
            text = strip_html(item.get("title", "")) + " " + strip_html(item.get("description", ""))
            all_texts.append(text)
        logger.info(f"  '{query}': {len(items)}건 수집")

    logger.info(f"총 {len(all_texts)}개 블로그 스니펫 수집 완료")

    if not all_texts:
        logger.warning("수집된 블로그 데이터 없음")
        return []

    # 2. 명사 추출 + 빈도 집계
    noun_counter = Counter()
    food_co_occurrence = Counter()  # 음식 문맥 공출현 횟수

    for text in all_texts:
        nouns = extract_nouns(text)
        unique_nouns = set(nouns)
        noun_counter.update(unique_nouns)

        has_food_context = bool(unique_nouns & FOOD_CONTEXT_WORDS)
        if has_food_context:
            for n in unique_nouns:
                food_co_occurrence[n] += 1

    # 3. 기존 키워드 목록
    existing_db = {kw["keyword"] for kw in (get_all_keywords() or [])}
    existing_seed = set(get_flat_keywords())
    existing = existing_db | existing_seed | STOPWORDS

    # 4. 필터링
    candidates = []
    for noun, freq in noun_counter.most_common():
        if noun in existing:
            continue
        if freq < settings.DISCOVERY_MIN_FREQUENCY:
            break  # most_common은 빈도 내림차순

        # 음식 문맥 공출현 비율로 부스트
        food_ratio = food_co_occurrence.get(noun, 0) / freq if freq > 0 else 0
        score = freq * (1.5 if food_ratio > 0.3 else 1.0)

        candidates.append({
            "noun": noun,
            "frequency": freq,
            "food_score": round(score, 1),
            "food_ratio": round(food_ratio, 2),
        })

    # 점수순 정렬, 상위 N개
    candidates.sort(key=lambda x: x["food_score"], reverse=True)
    candidates = candidates[: settings.DISCOVERY_MAX_NEW_KEYWORDS]

    if not candidates:
        logger.info("새로 발견된 키워드 없음")
        return []

    # 5. 카테고리 분류 + DB 등록
    new_keywords = []
    for c in candidates:
        category = classify_category(c["noun"], noun_counter)
        kw_data = {
            "keyword": c["noun"],
            "category": category,
            "is_active": True,
            "baseline_volume": 0,
        }
        new_keywords.append(kw_data)
        logger.info(
            f"  새 키워드 발견: '{c['noun']}' (빈도={c['frequency']}, "
            f"음식점수={c['food_score']}, 카테고리={category})"
        )

    insert_keywords(new_keywords)
    logger.info(f"키워드 {len(new_keywords)}개 DB 등록 완료")
    return new_keywords
