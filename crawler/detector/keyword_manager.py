import re

from franchise_checker import is_franchise

SEED_KEYWORDS = {
    "디저트": [
        "버터떡",
        "두쫀쿠",
        "두바이초콜릿",
        "크루키",
        "약과",
        "탕후루",
        "마카롱",
        "크로플",
        "소금빵",
        "바스크치즈케이크",
        "쿵야떡볶이",
        "호두과자",
        "인절미",
        "카눌레",
        "뚱카롱",
    ],
    "음료": [
        "하이볼",
        "말차라떼",
        "흑당버블티",
        "아인슈페너",
        "레몬에이드",
        "딸기라떼",
        "크림라떼",
    ],
    "식사": [
        "마라탕",
        "마라샹궈",
        "로제떡볶이",
        "옥수수치즈",
        "엽떡",
        "장인약과",
        "우삼겹덮밥",
    ],
    "간식": [
        "붕어빵",
        "호떡",
        "계란빵",
        "핫도그",
        "츄러스",
        "꽈배기",
        "타코야키",
        "창억떡",
    ],
}

STOPWORDS = {
    "서울",
    "부산",
    "대구",
    "인천",
    "대전",
    "광주",
    "수원",
    "성남",
    "울산",
    "제주",
    "강남",
    "홍대",
    "건대",
    "이태원",
    "합정",
    "역삼",
    "판교",
    "종로",
    "명동",
    "신촌",
    "마포",
    "성수",
    "잠실",
    "여의도",
    "강서",
    "동네",
    "지역",
    "근처",
    "장소",
    "카페",
    "맛집",
    "매장",
    "가게",
    "식당",
    "레스토랑",
    "베이커리",
    "브런치",
    "뷔페",
    "메뉴",
    "주문",
    "예약",
    "포장",
    "배달",
    "택배",
    "테이크아웃",
    "오픈",
    "영업",
    "시간",
    "테이블",
    "좌석",
    "직원",
    "서비스",
    "분위기",
    "인테리어",
    "주차",
    "재방문",
    "블로그",
    "리뷰",
    "후기",
    "추천",
    "사진",
    "소개",
    "정보",
    "방문",
    "주소",
    "가격",
    "위치",
    "세트",
    "이벤트",
    "할인",
    "쿠폰",
    "적립",
    "사람",
    "요즘",
    "정말",
    "최근",
    "느낌",
    "이번",
    "올해",
    "작년",
    "내년",
    "인기",
    "트렌드",
    "유행",
    "신상",
    "감성",
    "여행",
    "일상",
    "데이트",
    "모임",
    "친구",
    "가족",
    "혼밥",
    "혼술",
    "한국",
    "일본",
    "중국",
    "미국",
    "음식",
    "디저트",
    "간식",
    "음료",
    "식사",
    "요리",
    "반찬",
    "재료",
    "식품",
    "커피",
    "우유",
    "물",
    "차",
    "술",
    "맥주",
    "와인",
    "소주",
    "빵",
    "떡",
    "과자",
    "케이크",
    "쿠키",
    "초콜릿",
    "사탕",
    "젤리",
    "아이스크림",
    "고기",
    "생선",
    "야채",
    "과일",
    "밥",
    "면",
    "국",
    "찌개",
    "탕",
    "편의점",
    "마트",
    "제품",
    "상품",
    "브랜드",
    "패키지",
    "한정판",
    "콜라보",
    "버터",
    "크림",
    "설탕",
    "소금",
    "치즈",
    "소스",
    "시럽",
    "오늘",
    "내일",
    "어제",
    "매일",
    "주말",
    "평일",
    "기분",
    "선물",
    "생일",
    "아이",
    "엄마",
    "아빠",
    "남편",
    "아내",
    "다이어트",
    "건강",
    "칼로리",
    "레시피",
    "만들기",
    "방법",
    "과정",
    "완성",
    "준비",
    "길거리",
    "길거리음식",
    "길거리간식",
    "먹거리",
    "틱톡",
    "치킨",
    "피자",
    "버거",
    "라면",
    "삼겹살",
    "갈비",
    "냉면",
    "짜장면",
    "짬뽕",
    "비빔밥",
    "국밥",
    "김치",
    "잡채",
    "순대",
    "떡볶이",
    "김밥",
    "바이럴",
    "거리",
    "고민",
    "정리",
    "정도",
    "이유",
    "인스타",
    "유튜브",
    "콘텐츠",
    "영상",
    "채널",
    "구독",
    "조회수",
    "맛있는",
    "먹방",
    "푸드",
    "핫플레이스",
    "키워드",
    "인스타그램",
    "릴스",
    "요즘유행",
    "요즘트렌드",
    "트렌디",
    "메뉴출시",
    "가성비",
    "외국인",
    "콘텐츠제작",
    "도전",
    "이야기",
    "예전",
    "후쿠오카",
}

FOOD_CONTEXT_WORDS = {
    "맛있",
    "달콤",
    "식감",
    "쫀득",
    "바삭",
    "고소",
    "촉촉",
    "폭발",
    "중독",
    "존맛",
    "꿀맛",
    "핫플",
    "줄서",
    "오픈런",
}

FOOD_SUFFIXES = (
    "떡",
    "빵",
    "면",
    "밥",
    "탕",
    "전",
    "편",
    "병",
    "볶이",
    "국수",
    "만두",
    "순대",
    "라떼",
    "치킨",
    "피자",
    "버거",
    "타코",
    "파이",
    "칩",
    "롤",
    "볼",
    "바",
    "쿠키",
    "젤리",
    "푸딩",
    "타르트",
    "크림",
    "소스",
    "잼",
    "주스",
    "에이드",
    "스무디",
    "티",
    "까스",
    "겹살",
    "파스타",
    "초밥",
    "도넛",
    "토스트",
)

FOOD_PREFIXES = (
    "제로",
    "크림",
    "치즈",
    "초코",
    "딸기",
    "말차",
    "흑당",
    "마라",
    "갈릭",
    "버터",
    "소금",
    "땅콩",
    "아몬드",
    "우삼겹",
)

CATEGORY_SIGNALS = {
    "디저트": {
        "디저트",
        "케이크",
        "빵",
        "쿠키",
        "마카롱",
        "달콤",
        "쫀득",
        "바삭",
        "크림",
        "초콜릿",
    },
    "음료": {
        "음료",
        "라떼",
        "커피",
        "차",
        "주스",
        "스무디",
        "아이스",
        "카페인",
        "시럽",
    },
    "식사": {
        "밥",
        "면",
        "국",
        "탕",
        "찌개",
        "고기",
        "파스타",
        "볶음",
        "구이",
        "덮밥",
    },
    "간식": {
        "간식",
        "과자",
        "스낵",
        "떡",
        "호떡",
        "포차",
        "튀김",
    },
}

META_KEYWORD_PATTERNS = (
    "트렌드",
    "유행",
    "콘텐츠",
    "키워드",
    "먹거리",
    "맛집",
    "인스타",
    "릴스",
    "유튜브",
    "틱톡",
    "바이럴",
    "조회수",
    "브랜드",
    "메뉴",
    "카페",
    "매장",
    "신상",
    "길거리",
    "인기음식",
    "핫푸드",
    "음식추천",
    "간식거리",
)

GENERIC_FOOD_KEYWORDS = frozenset({
    "음식",
    "먹거리",
    "길거리",
    "길거리음식",
    "식사",
    "간식",
    "디저트",
    "음료",
    "치킨",
    "피자",
    "버거",
    "햄버거",
    "떡볶이",
    "라면",
    "국밥",
    "분식",
    "제로슈거",
    "마라탕후루",
})

_SEED_KEYWORD_SET = frozenset(
    keyword
    for keyword_list in SEED_KEYWORDS.values()
    for keyword in keyword_list
)
_FOOD_SIGNAL_TERMS = frozenset(
    signal
    for signals in CATEGORY_SIGNALS.values()
    for signal in signals
    if len(signal) >= 2
)
_DISCOVERY_NORMALIZE_RE = re.compile(r"[^0-9A-Za-z\uAC00-\uD7A3]+")
_DISCOVERY_PRICE_PREFIX_RE = re.compile(
    r"^(?:\d+(?:천|만)?원?(?:대)?|\d+개입?|\d+위|\d+종|\d+탄|\d+분컷|\d+초컷)+"
)
_DISCOVERY_PREFIX_NOISE_TERMS = tuple(
    sorted(
        {
            "제품제공",
            "최신",
            "요즘",
            "유행",
            "핫한",
            "핫",
            "신상",
            "추천",
            "리뷰",
            "정리",
            "총정리",
            "랭킹",
            "편의점",
            "카페",
            "맛집",
            "먹방",
            "급상승",
            "인기",
            "viral",
            "sns",
            "shorts",
            "short",
            "ytshorts",
            "쇼츠",
            "cu",
            "gs25",
            "gs",
            "세븐일레븐",
            "이마트24",
            "emart24",
            "이하",
        },
        key=len,
        reverse=True,
    )
)
_DISCOVERY_SUFFIX_NOISE_TERMS = tuple(
    sorted(
        {
            "제품제공",
            "추천",
            "리뷰",
            "먹방",
            "유행",
            "정리",
            "총정리",
            "랭킹",
            "버전",
            "ver",
            "shorts",
            "short",
            "ytshorts",
            "쇼츠",
        },
        key=len,
        reverse=True,
    )
)
_DISCOVERY_DESCRIPTOR_PREFIXES = frozenset(
    {
        "\ucb80\ub4dd",
        "즉석",
        "캐릭터",
        "칠리",
        "콘카르네",
        "수제",
        "바삭",
        "촉촉",
    }
)
_DISCOVERY_CORE_PREFIXES = tuple(
    sorted(
        set(FOOD_PREFIXES)
        | set(FOOD_CONTEXT_WORDS)
        | set(_SEED_KEYWORD_SET)
        | {
            "\ucb80\ub4dd",
            "즉석",
            "수제",
            "캐릭터",
            "칠리",
            "콘카르네",
            "초콜릿",
            "브라우니",
            "쿠키",
            "핫도그",
            "떡볶이",
            "국밥",
            "냉면",
        },
        key=len,
        reverse=True,
    )
)
_DISCOVERY_FOOD_ANCHORS = tuple(
    sorted(
        {
            "핫도그",
            "브라우니",
            "쿠키",
            "국밥",
            "냉면",
            "떡볶이",
            "초콜릿",
            "콘카르네",
            "파스타",
            "토스트",
            "타르트",
            "스무디",
            "에이드",
            "라떼",
            "주스",
            "국수",
            "만두",
            "타코",
            "겹살",
            "버거",
            "파이",
            "초밥",
            "치킨",
            "도넛",
            "피자",
            "크림",
            "젤리",
            "푸딩",
            "까스",
            "순대",
            "소스",
            "빵",
            "탕",
            "밥",
            "떡",
        },
        key=len,
        reverse=True,
    )
)


def get_all_seed_keywords() -> list[dict]:
    """시드 키워드 목록을 DB 형식으로 반환"""
    keywords = []
    for category, kw_list in SEED_KEYWORDS.items():
        for kw in kw_list:
            keywords.append({
                "keyword": kw,
                "category": category,
                "is_active": True,
                "baseline_volume": 0,
            })
    return keywords


def get_flat_keywords() -> list[str]:
    """모든 시드 키워드를 flat list로 반환"""
    result = []
    for kw_list in SEED_KEYWORDS.values():
        result.extend(kw_list)
    return result


def normalize_keyword(keyword: str) -> str:
    return re.sub(r"\s+", "", keyword).strip()


def _normalize_discovery_text(keyword: str) -> str:
    cleaned = normalize_keyword(keyword).lower()
    return _DISCOVERY_NORMALIZE_RE.sub("", cleaned)


def _strip_discovery_noise(keyword: str) -> str:
    cleaned = _normalize_discovery_text(keyword)
    previous = None
    while cleaned and cleaned != previous:
        previous = cleaned
        cleaned = _DISCOVERY_PRICE_PREFIX_RE.sub("", cleaned)

        for prefix in _DISCOVERY_PREFIX_NOISE_TERMS:
            if cleaned.startswith(prefix) and len(cleaned) > len(prefix) + 1:
                cleaned = cleaned[len(prefix) :]
                break

        for suffix in _DISCOVERY_SUFFIX_NOISE_TERMS:
            if cleaned.endswith(suffix) and len(cleaned) > len(suffix) + 1:
                cleaned = cleaned[: -len(suffix)]
                break

    half = len(cleaned) // 2
    if half > 1 and len(cleaned) % 2 == 0 and cleaned[:half] == cleaned[half:]:
        cleaned = cleaned[:half]

    return cleaned


def _iter_discovery_core_positions(keyword: str) -> list[int]:
    positions: set[int] = {0}
    for term in _DISCOVERY_CORE_PREFIXES:
        start = 0
        while True:
            index = keyword.find(term, start)
            if index < 0:
                break
            positions.add(index)
            start = index + 1
    return sorted(positions)


def _discovery_leading_noise_penalty(keyword: str) -> float:
    positions = [position for position in _iter_discovery_core_positions(keyword) if position > 0]
    if not positions:
        return 0.0

    first_position = min(positions)
    prefix = keyword[:first_position]
    if len(prefix) < 2 or has_food_signal(prefix) or prefix in _SEED_KEYWORD_SET:
        return 0.0
    return float(min(first_position, 6) * 2)


def _score_discovery_candidate(keyword: str) -> float:
    cleaned = _strip_discovery_noise(keyword)
    if len(cleaned) < 2:
        return -100.0

    score = min(len(cleaned), 12) * 0.25
    if cleaned in _SEED_KEYWORD_SET:
        score += 10.0
    if _has_discovery_food_anchor(cleaned):
        score += 8.0
    if cleaned.endswith(FOOD_SUFFIXES):
        score += 4.0
    score += sum(3.0 for prefix in FOOD_PREFIXES if prefix in cleaned)
    score += sum(2.5 for context in FOOD_CONTEXT_WORDS if context in cleaned)
    if any(cleaned.startswith(prefix) for prefix in _DISCOVERY_DESCRIPTOR_PREFIXES):
        score += 3.0
    if is_food_specific_keyword(cleaned):
        score += 5.0
    if is_generic_keyword(cleaned):
        score -= 6.0
    score -= _discovery_leading_noise_penalty(cleaned)
    return score


def _has_discovery_food_anchor(keyword: str) -> bool:
    cleaned = _strip_discovery_noise(keyword)
    if not cleaned:
        return False
    if cleaned in _SEED_KEYWORD_SET:
        return True
    return any(anchor in cleaned for anchor in _DISCOVERY_FOOD_ANCHORS)


def canonicalize_discovered_keyword(keyword: str) -> str | None:
    cleaned = _strip_discovery_noise(keyword)
    if len(cleaned) < 2:
        return None

    candidates: set[str] = {cleaned}
    for position in _iter_discovery_core_positions(cleaned):
        if position <= 0:
            continue
        trimmed = _strip_discovery_noise(cleaned[position:])
        if len(trimmed) >= 2:
            candidates.add(trimmed)

    scored_candidates = [
        (_score_discovery_candidate(candidate), len(candidate), candidate)
        for candidate in candidates
    ]
    if not scored_candidates:
        return None

    score, _, best_candidate = max(scored_candidates, key=lambda item: (item[0], item[1]))
    if not _has_discovery_food_anchor(best_candidate):
        return None
    if score <= 0 and best_candidate not in _SEED_KEYWORD_SET:
        return None
    return best_candidate


def is_brand_keyword(keyword: str) -> bool:
    normalized = normalize_keyword(keyword)
    if not normalized:
        return False
    return is_franchise(normalized)


def is_food_like_token(token: str, tag: str = "NNG") -> bool:
    """음식명일 가능성이 높은 토큰인지 판별

    단순 길이(>=3)만으로 통과시키면 '길거리', '치킨' 같은 일반 명사가
    키워드 후보로 올라오므로, 음식 신호(접두사/접미사/시드)가 있는
    토큰만 허용한다.
    """
    normalized = normalize_keyword(token)
    if is_brand_keyword(normalized):
        return False
    if normalized in _SEED_KEYWORD_SET:
        return True
    if normalized in STOPWORDS or normalized in GENERIC_FOOD_KEYWORDS:
        return False
    if tag == "NNP":
        return True
    if normalized.startswith(FOOD_PREFIXES):
        return True
    if normalized.endswith(FOOD_SUFFIXES) and len(normalized) > 1:
        return True
    if any(signal in normalized for signal in _FOOD_SIGNAL_TERMS):
        return True
    return False


def is_generic_keyword(keyword: str) -> bool:
    normalized = normalize_keyword(keyword)
    if not normalized:
        return True
    if is_brand_keyword(normalized):
        return True
    if normalized in STOPWORDS or normalized in GENERIC_FOOD_KEYWORDS:
        return True
    # 1단어 일반 메뉴명은 제외하고, 수식어가 붙은 구체 키워드만 허용
    if (
        normalized.endswith(FOOD_SUFFIXES)
        and len(normalized) <= 3
        and normalized not in _SEED_KEYWORD_SET
    ):
        return True
    return any(pattern in normalized for pattern in META_KEYWORD_PATTERNS)


def has_food_signal(keyword: str) -> bool:
    normalized = normalize_keyword(keyword)
    if not normalized:
        return False
    if normalized in _SEED_KEYWORD_SET:
        return True
    if any(seed_keyword in normalized for seed_keyword in _SEED_KEYWORD_SET):
        return True
    if normalized.startswith(FOOD_PREFIXES):
        return True
    for suffix in FOOD_SUFFIXES:
        if normalized.endswith(suffix) and len(normalized) > len(suffix):
            return True
    return any(signal in normalized for signal in _FOOD_SIGNAL_TERMS)


def is_food_specific_keyword(keyword: str) -> bool:
    normalized = normalize_keyword(keyword)
    if len(normalized) < 2:
        return False
    if is_generic_keyword(normalized):
        return False
    return has_food_signal(normalized)
