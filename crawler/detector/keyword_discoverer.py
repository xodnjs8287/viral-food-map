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
    # 넓은 범위
    "요즘 핫한 음식 트렌드",
    "SNS 인기 음식 2026",
    "요즘 뭐 먹지 추천",
    "틱톡 바이럴 음식",
    # 카테고리별
    "요즘 뜨는 디저트",
    "요즘 유행하는 간식 거리음식",
    "핫한 맛집 메뉴 신메뉴",
    "요즘 핫한 음료 카페 신메뉴",
    "요즘 뜨는 분식 길거리",
    "편의점 신상 먹거리",
]

STOPWORDS = {
    # 장소/지역
    "서울", "부산", "대구", "인천", "대전", "광주", "수원", "성남", "울산", "제주",
    "강남", "홍대", "건대", "이태원", "합정", "역삼", "판교", "종로", "명동", "신촌",
    "마포", "성수", "잠실", "여의도", "강서", "동네", "지역", "근처", "장소",
    # 식당/카페 일반
    "카페", "맛집", "매장", "가게", "식당", "레스토랑", "베이커리", "브런치", "뷔페",
    "메뉴", "주문", "예약", "포장", "배달", "택배", "테이크아웃", "오픈", "영업", "시간",
    "테이블", "좌석", "직원", "서비스", "분위기", "인테리어", "주차", "재방문",
    # 블로그/리뷰 일반
    "블로그", "리뷰", "후기", "추천", "사진", "소개", "정보", "방문", "주소",
    "가격", "위치", "세트", "이벤트", "할인", "쿠폰", "적립",
    # 너무 일반적인 명사
    "사람", "요즘", "정말", "최근", "느낌", "이번", "올해", "작년", "내년",
    "인기", "트렌드", "유행", "신상", "감성", "여행", "일상", "데이트", "모임",
    "친구", "가족", "혼밥", "혼술", "한국", "일본", "중국", "미국",
    # 일반 음식/식품 카테고리 (구체적 음식명이 아닌 것)
    "음식", "디저트", "간식", "음료", "식사", "요리", "반찬", "재료", "식품",
    "커피", "우유", "물", "차", "술", "맥주", "와인", "소주",
    "빵", "떡", "과자", "케이크", "쿠키", "초콜릿", "사탕", "젤리", "아이스크림",
    "고기", "생선", "야채", "과일", "밥", "면", "국", "찌개", "탕",
    # 식품/편의점 일반
    "편의점", "마트", "제품", "상품", "브랜드", "패키지", "한정판", "콜라보",
    "버터", "크림", "설탕", "소금", "치즈", "소스", "시럽",
    # 기타 일반어
    "오늘", "내일", "어제", "매일", "주말", "평일", "기분", "선물", "생일",
    "아이", "엄마", "아빠", "남편", "아내", "다이어트", "건강", "칼로리",
    "레시피", "만들기", "재료", "방법", "과정", "완성", "준비",
    # 이전 테스트에서 잘못 등록된 일반어
    "길거리", "먹거리", "틱톡", "바이럴", "거리", "고민", "정리", "정도", "이유",
    "인스타", "유튜브", "콘텐츠", "영상", "채널", "구독", "조회수",
    "맛있는", "먹방", "먹거리", "푸드", "핫플레이스",
}

FOOD_CONTEXT_WORDS = {"맛있", "달콤", "식감", "쫀득", "바삭", "고소", "촉촉", "폭발", "중독", "존맛", "꿀맛", "핫플", "줄서", "오픈런"}

# 음식 관련 접미사 — 2글자 명사라도 이 접미사로 끝나면 허용
FOOD_SUFFIXES = (
    "떡", "빵", "면", "밥", "탕", "전", "편", "병", "볶이", "국수", "만두", "순대",
    "라떼", "치킨", "피자", "버거", "타코", "파이", "칩", "롤", "볼", "바",
    "쿠키", "젤리", "푸딩", "타르트", "크림", "소스", "잼",
    "주스", "에이드", "스무디", "티",
)

# 음식 관련 접두사 — 이 단어로 시작하는 복합명사는 높은 확률로 음식명
FOOD_PREFIXES = (
    "크림", "치즈", "초코", "딸기", "말차", "흑당", "꿀", "생", "왕",
    "불", "매운", "마라", "갈릭", "버터", "소금", "땅콩", "아몬드",
)

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


def _is_food_like(token: str, tag: str = "NNG") -> bool:
    """음식명일 가능성이 높은 단어인지 판별"""
    if len(token) >= 3:
        return True
    # 고유명사(NNP)는 2글자도 허용 (브랜드/제품명)
    if tag == "NNP":
        return True
    # 2글자라도 음식 접미사로 끝나면 허용 (호떡, 약과 등)
    return token.endswith(FOOD_SUFFIXES)


def extract_nouns(text: str) -> list[str]:
    """kiwipiepy로 명사 추출 — 복합명사 결합 + 음식명 필터링

    1) 인접한 명사를 결합해 복합명사 생성 (창억+떡 → 창억떡)
    2) 3글자 이상이거나 음식 접미사를 가진 2글자 명사만 통과
    """
    kiwi = get_kiwi()
    result = kiwi.analyze(text)

    # 1단계: 토큰 리스트에서 인접 명사 결합
    tokens = result[0][0]  # [(token, tag, ...), ...]
    nouns = []
    i = 0
    while i < len(tokens):
        token, tag, *_ = tokens[i]
        if tag not in ("NNG", "NNP"):
            i += 1
            continue

        # 인접 명사 결합 시도 (최대 3개 토큰까지)
        compound = token
        j = i + 1
        while j < len(tokens) and j - i < 3:
            next_token, next_tag, *_ = tokens[j]
            if next_tag not in ("NNG", "NNP"):
                break
            compound += next_token
            j += 1

        # 복합명사(2+ 토큰 결합)가 유효하면 우선 채택
        if j > i + 1 and 3 <= len(compound) <= 12:
            nouns.append(compound)
            i = j
            continue

        # 단일 명사 — 음식명 필터 통과 시 채택
        if 2 <= len(token) <= 10 and _is_food_like(token, tag):
            nouns.append(token)
        i += 1

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
