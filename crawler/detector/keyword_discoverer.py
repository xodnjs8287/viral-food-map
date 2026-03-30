import re
import logging
from collections import Counter

import httpx
from kiwipiepy import Kiwi

from config import settings
from database import get_all_keywords, insert_keywords
from detector.keyword_manager import (
    CATEGORY_SIGNALS,
    FOOD_CONTEXT_WORDS,
    STOPWORDS,
    get_flat_keywords,
    is_food_like_token,
    is_food_specific_keyword,
)

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
        if 2 <= len(token) <= 10 and is_food_like_token(token, tag):
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


async def discover_keywords() -> dict:
    """블로그 기반 키워드 자동 발굴 파이프라인"""
    logger.info("키워드 발굴 시작")
    summary = {
        "queries": len(META_QUERIES),
        "collected_posts": 0,
        "new_keywords": 0,
        "keywords": [],
    }

    # 1. 블로그 검색으로 텍스트 수집
    all_texts = []
    for query in META_QUERIES:
        items = await search_blogs(query)
        for item in items:
            text = strip_html(item.get("title", "")) + " " + strip_html(item.get("description", ""))
            all_texts.append(text)
        logger.info(f"  '{query}': {len(items)}건 수집")

    summary["collected_posts"] = len(all_texts)
    logger.info(f"총 {len(all_texts)}개 블로그 스니펫 수집 완료")

    if not all_texts:
        logger.warning("수집된 블로그 데이터 없음")
        return summary

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
        if not is_food_specific_keyword(noun):
            continue

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
        return summary

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
    summary["new_keywords"] = len(new_keywords)
    summary["keywords"] = [kw["keyword"] for kw in new_keywords]
    logger.info(f"키워드 {len(new_keywords)}개 DB 등록 완료")
    return summary
