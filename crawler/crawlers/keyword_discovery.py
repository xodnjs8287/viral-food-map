"""
키워드 디스커버리: 네이버 블로그/쇼핑 트렌드에서 신규 음식 키워드 자동 발견
"""
import re
import httpx
import logging
from collections import Counter

from config import settings

logger = logging.getLogger(__name__)

NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/blog"

# 발견에 사용할 검색 쿼리
DISCOVERY_QUERIES = [
    "요즘 유행 음식",
    "요즘 뜨는 디저트",
    "바이럴 음식",
    "신상 맛집 인기",
    "요즘 핫한 음식",
    "인기 음식 트렌드",
    "유행 간식",
    "줄서는 맛집 신상",
]

# 카테고리 분류 패턴
CATEGORY_PATTERNS = {
    "디저트": r"(케이크|마카롱|쿠키|크림|빵|타르트|롤|파이|떡케이크|찹쌀|약과|탕후루|초콜릿)",
    "음료": r"(라떼|티|에이드|주스|버블|보바|스무디|커피|아이스티)",
    "식사": r"(덮밥|국수|라면|볶음|찌개|돈까스|파스타|피자|버거|샌드위치|초밥|김밥)",
    "간식": r"(떡|빵|호떡|붕어빵|계란빵|핫도그|츄러스|꽈배기|타코야키|팝콘)",
}

# 제외할 일반 단어 (음식 이름이 아닌 것들)
STOP_WORDS = {
    "음식", "맛집", "식당", "카페", "디저트", "간식", "분식", "한식", "중식", "일식",
    "양식", "요리", "레시피", "먹방", "유행", "인기", "신상", "트렌드", "메뉴",
    "가격", "솔직", "리뷰", "후기", "추천", "맛있", "맛없", "진짜", "정말",
    "완전", "너무", "이거", "저거", "그거", "한번", "두번", "먹어", "먹고",
}


def extract_food_keywords(title: str) -> list[str]:
    """블로그 제목에서 잠재적 음식 키워드 추출"""
    # HTML 태그 제거
    clean = re.sub(r"<[^>]+>", "", title)

    candidates = []

    # 패턴 1: food suffix를 가진 2-5글자 한국어 단어
    food_suffixes = r"(떡|빵|케이크|탕|라떼|볼|쿠키|치즈|크림|롤|타르트|에이드|주스|스무디|버거|덮밥|국수|라면|튀김|볶음|초콜릿|파이|마카롱|츄러스)"
    pattern = rf"[가-힣]{{1,4}}{food_suffixes}"
    matches = re.findall(pattern, clean)
    for m in matches:
        word = m if isinstance(m, str) else "".join(m)
        if len(word) >= 2 and word not in STOP_WORDS:
            candidates.append(word)

    # 패턴 2: 따옴표나 '신상', '요즘' 뒤에 오는 2-5글자 한국어 단어
    quoted = re.findall(r"['\"]([가-힣]{2,5})['\"]", clean)
    candidates.extend([w for w in quoted if w not in STOP_WORDS])

    hot_word_pattern = re.findall(
        r"(?:신상|요즘|최근|요새|핫한|뜨는|유행)\s+([가-힣]{2,5})", clean
    )
    candidates.extend([w for w in hot_word_pattern if w not in STOP_WORDS])

    return list(set(candidates))


def guess_category(keyword: str) -> str:
    """키워드로 카테고리 추정"""
    for category, pattern in CATEGORY_PATTERNS.items():
        if re.search(pattern, keyword):
            return category
    return "기타"


async def discover_new_keywords(existing_keywords: set[str]) -> list[dict]:
    """네이버 블로그 검색으로 신규 음식 키워드 발견"""
    headers = {
        "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
    }

    keyword_counter: Counter = Counter()

    async with httpx.AsyncClient() as client:
        for query in DISCOVERY_QUERIES:
            try:
                resp = await client.get(
                    NAVER_SEARCH_URL,
                    params={"query": query, "display": 100, "sort": "date"},
                    headers=headers,
                    timeout=10,
                )
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("items", []):
                    title = item.get("title", "")
                    keywords = extract_food_keywords(title)
                    for kw in keywords:
                        keyword_counter[kw] += 1

            except Exception as e:
                logger.error(f"키워드 디스커버리 검색 오류 ({query}): {e}")

    # 2회 이상 등장하고 기존에 없는 키워드만 필터링
    new_keywords = []
    for keyword, count in keyword_counter.most_common(20):
        if keyword not in existing_keywords and count >= 2:
            category = guess_category(keyword)
            new_keywords.append({
                "keyword": keyword,
                "category": category,
                "is_active": True,
                "source": "discovered",
                "baseline_volume": 0,
            })
            logger.info(f"신규 키워드 발견: '{keyword}' (카테고리: {category}, 등장: {count}회)")

    logger.info(f"키워드 디스커버리 완료: {len(new_keywords)}개 신규 발견")
    return new_keywords
