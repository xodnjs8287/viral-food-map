from __future__ import annotations

import random
import re
from typing import Any

import httpx

from config import settings
from database import get_store_trend_lookup

KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json"
PAGE_SIZE = 15
MAX_PAGES = 3


class YomechuNoResultsError(RuntimeError):
    pass


CATEGORY_CONFIG = {
    "all": {"label": "전체", "group_code": "FD6", "tokens": []},
    "korean": {"label": "한식", "group_code": "FD6", "tokens": ["한식"]},
    "chinese": {"label": "중식", "group_code": "FD6", "tokens": ["중식", "중국식"]},
    "japanese": {
        "label": "일식",
        "group_code": "FD6",
        "tokens": ["일식", "초밥", "우동", "라멘", "돈까스", "이자카야"],
    },
    "western": {
        "label": "양식",
        "group_code": "FD6",
        "tokens": ["양식", "이탈리안", "파스타", "스테이크", "햄버거"],
    },
    "snack": {"label": "분식", "group_code": "FD6", "tokens": ["분식", "떡볶이", "김밥"]},
    "chicken": {"label": "치킨", "group_code": "FD6", "tokens": ["치킨", "닭강정"]},
    "pizza": {"label": "피자", "group_code": "FD6", "tokens": ["피자"]},
    "asian": {
        "label": "아시안",
        "group_code": "FD6",
        "tokens": ["베트남", "태국", "인도", "동남아", "아시아"],
    },
    "cafe-dessert": {"label": "카페/디저트", "group_code": "CE7", "tokens": []},
    "pub": {
        "label": "주점",
        "group_code": "FD6",
        "tokens": ["술집", "호프", "맥주", "포차", "바", "와인", "이자카야"],
    },
}


def normalize_text(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", value.lower())


def extract_category_label(category_name: str, fallback_label: str) -> str:
    parts = [part.strip() for part in category_name.split(">") if part.strip()]
    if not parts:
        return fallback_label
    return parts[-1]


def matches_category(category_slug: str, category_name: str) -> bool:
    config = CATEGORY_CONFIG[category_slug]
    tokens = config["tokens"]

    if category_slug == "cafe-dessert":
        normalized = category_name.lower()
        return any(
            token in normalized
            for token in ["카페", "커피", "디저트", "베이커리", "빙수"]
        )

    if not tokens:
        return True

    normalized = category_name.lower()
    return any(token.lower() in normalized for token in tokens)


def build_trend_lookup() -> dict[tuple[str, str], list[str]]:
    lookup: dict[tuple[str, str], set[str]] = {}

    for row in get_store_trend_lookup():
        trend_name = (row.get("trends") or {}).get("name")
        name = row.get("name")
        address = row.get("address")
        if not trend_name or not name or not address:
            continue

        key = (normalize_text(name), normalize_text(address))
        if key not in lookup:
            lookup[key] = set()
        lookup[key].add(trend_name)

    return {key: sorted(value) for key, value in lookup.items()}


async def fetch_category_places(
    category_group_code: str,
    lat: float,
    lng: float,
    radius_m: int,
) -> list[dict[str, Any]]:
    headers = {"Authorization": f"KakaoAK {settings.KAKAO_REST_API_KEY}"}
    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with httpx.AsyncClient() as client:
        for page in range(1, MAX_PAGES + 1):
            response = await client.get(
                KAKAO_CATEGORY_URL,
                params={
                    "category_group_code": category_group_code,
                    "x": str(lng),
                    "y": str(lat),
                    "radius": str(radius_m),
                    "sort": "distance",
                    "page": page,
                    "size": PAGE_SIZE,
                },
                headers=headers,
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()

            for doc in payload.get("documents", []):
                place_id = str(doc.get("id"))
                if not place_id or place_id in seen:
                    continue
                seen.add(place_id)
                results.append(doc)

            if payload.get("meta", {}).get("is_end", True):
                break

    return results


def distance_weight(distance_m: int, radius_m: int) -> float:
    if radius_m <= 0:
        return 1.0
    return max(0.15, 1 - min(distance_m / radius_m, 1.0))


def candidate_weight(candidate: dict[str, Any], radius_m: int) -> float:
    base = distance_weight(candidate["distance_m"], radius_m)
    trend_bonus = 0.2 if candidate.get("trend_names") else 0
    return base + trend_bonus


def weighted_sample_without_replacement(
    candidates: list[dict[str, Any]],
    radius_m: int,
    count: int,
) -> list[dict[str, Any]]:
    remaining = candidates.copy()
    winners: list[dict[str, Any]] = []

    while remaining and len(winners) < count:
        weights = [candidate_weight(candidate, radius_m) for candidate in remaining]
        winner = random.choices(remaining, weights=weights, k=1)[0]
        winners.append(winner)
        remaining = [
            candidate
            for candidate in remaining
            if candidate["place_id"] != winner["place_id"]
        ]

    return winners


def build_reel(candidates: list[dict[str, Any]], winner: dict[str, Any]) -> list[dict[str, Any]]:
    pool = candidates[: min(len(candidates), 8)]
    reel = [random.choice(pool) for _ in range(11)] if pool else [winner]
    reel.append(winner)
    return reel


def build_response_item(place: dict[str, Any], requested_slug: str) -> dict[str, Any]:
    return {
        "place_id": place["place_id"],
        "name": place["name"],
        "address": place["address"],
        "category_label": extract_category_label(
            place.get("category_name") or "",
            CATEGORY_CONFIG[requested_slug]["label"],
        ),
        "distance_m": place["distance_m"],
        "rating": place.get("rating"),
        "trend_names": place.get("trend_names", []),
        "place_url": place.get("place_url")
        or f"https://map.kakao.com/link/search/{place['name']}",
    }


async def find_yomechu_candidates(
    lat: float,
    lng: float,
    radius_m: int,
    category_slug: str,
    result_count: int,
) -> tuple[list[dict[str, Any]], bool]:
    config = CATEGORY_CONFIG[category_slug]
    requested = await fetch_category_places(config["group_code"], lat, lng, radius_m)
    requested = [
        doc for doc in requested if matches_category(category_slug, doc.get("category_name", ""))
    ]

    used_fallback = False
    if category_slug != "all" and len(requested) < result_count:
        requested = await fetch_category_places(
            CATEGORY_CONFIG["all"]["group_code"], lat, lng, radius_m
        )
        used_fallback = True

    if not requested:
        raise YomechuNoResultsError("근처에서 조건에 맞는 매장을 찾지 못했습니다.")

    trend_lookup = build_trend_lookup()
    candidates: list[dict[str, Any]] = []

    for doc in requested:
        address = doc.get("road_address_name") or doc.get("address_name") or ""
        key = (normalize_text(doc.get("place_name", "")), normalize_text(address))
        candidates.append(
            {
                "place_id": str(doc["id"]),
                "name": doc["place_name"],
                "address": address,
                "category_name": doc.get("category_name") or config["label"],
                "distance_m": int(doc.get("distance") or 0),
                "rating": None,
                "trend_names": trend_lookup.get(key, []),
                "place_url": doc.get("place_url") or None,
            }
        )

    candidates.sort(key=lambda item: item["distance_m"])
    return candidates[: min(len(candidates), 15)], used_fallback


async def spin_yomechu(
    lat: float,
    lng: float,
    radius_m: int,
    category_slug: str,
    result_count: int,
    session_id: str | None,
) -> dict[str, Any]:
    del session_id

    if category_slug not in CATEGORY_CONFIG:
        raise ValueError(f"Unsupported category: {category_slug}")

    if result_count not in (1, 2, 3, 4, 5):
        raise ValueError(f"Unsupported result count: {result_count}")

    candidates, used_fallback = await find_yomechu_candidates(
        lat=lat,
        lng=lng,
        radius_m=radius_m,
        category_slug=category_slug,
        result_count=result_count,
    )

    if not candidates:
        raise YomechuNoResultsError("추천할 후보가 없습니다.")

    winners = weighted_sample_without_replacement(candidates, radius_m, result_count)
    primary_winner = winners[0]
    reel = build_reel(candidates, primary_winner)

    return {
        "spin_id": None,
        "pool_size": len(candidates),
        "used_fallback": used_fallback,
        "result_count": len(winners),
        "reel": [build_response_item(item, category_slug) for item in reel],
        "winner": build_response_item(primary_winner, category_slug),
        "winners": [build_response_item(item, category_slug) for item in winners],
    }
