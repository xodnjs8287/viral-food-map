from __future__ import annotations

import logging
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from config import settings
from crawlers.store_finder import fetch_naver_rating
from database import (
    get_store_trend_lookup,
    get_yomechu_places_by_external_ids,
    insert_yomechu_spin,
    list_recent_yomechu_places,
    update_yomechu_place,
    upsert_yomechu_places,
)

logger = logging.getLogger(__name__)

KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
PAGE_SIZE = 15
MAX_PAGES = 3


class YomechuNoResultsError(RuntimeError):
    pass


CATEGORY_CONFIG = {
    "all": {"label": "전체", "group_code": "FD6", "tokens": [], "keyword": None},
    "korean": {"label": "한식", "group_code": "FD6", "tokens": ["한식"], "keyword": "한식"},
    "chinese": {"label": "중식", "group_code": "FD6", "tokens": ["중식", "중국식"], "keyword": "중식"},
    "japanese": {
        "label": "일식",
        "group_code": "FD6",
        "tokens": ["일식", "초밥", "우동", "라멘", "돈까스", "이자카야"],
        "keyword": "일식",
    },
    "western": {
        "label": "양식",
        "group_code": "FD6",
        "tokens": ["양식", "이탈리안", "파스타", "스테이크", "햄버거"],
        "keyword": "양식",
    },
    "snack": {"label": "분식", "group_code": "FD6", "tokens": ["분식", "떡볶이", "김밥"], "keyword": "분식"},
    "chicken": {"label": "치킨", "group_code": "FD6", "tokens": ["치킨", "닭강정"], "keyword": "치킨"},
    "pizza": {"label": "피자", "group_code": "FD6", "tokens": ["피자"], "keyword": "피자"},
    "asian": {
        "label": "아시안",
        "group_code": "FD6",
        "tokens": ["베트남", "태국", "인도", "동남아", "아시아"],
        "keyword": "아시안푸드",
    },
    "cafe-dessert": {"label": "카페/디저트", "group_code": "CE7", "tokens": [], "keyword": "카페"},
    "pub": {
        "label": "주점",
        "group_code": "FD6",
        "tokens": ["술집", "호프", "맥주", "포차", "바", "와인", "이자카야"],
        "keyword": "술집",
    },
}

_trend_lookup_cache: dict[str, Any] = {"expires_at": None, "data": None}


def normalize_text(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", value.lower())


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def extract_category_label(category_name: str, fallback_label: str) -> str:
    parts = [part.strip() for part in category_name.split(">") if part.strip()]
    if not parts:
        return fallback_label
    return parts[-1]


def matches_category(category_slug: str, category_name: str) -> bool:
    tokens = CATEGORY_CONFIG[category_slug]["tokens"]

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


def infer_category_slug(category_name: str) -> str:
    for category_slug in [
        "cafe-dessert",
        "pub",
        "chicken",
        "pizza",
        "snack",
        "korean",
        "chinese",
        "japanese",
        "western",
        "asian",
    ]:
        if matches_category(category_slug, category_name):
            return category_slug
    return "all"


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


def get_trend_lookup() -> dict[tuple[str, str], list[str]]:
    now = datetime.now(timezone.utc)
    expires_at = _trend_lookup_cache["expires_at"]
    if expires_at and expires_at > now and _trend_lookup_cache["data"] is not None:
        return _trend_lookup_cache["data"]

    data = build_trend_lookup()
    _trend_lookup_cache["data"] = data
    _trend_lookup_cache["expires_at"] = now + timedelta(minutes=5)
    return data


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


async def fetch_keyword_places(
    keyword: str,
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
                KAKAO_KEYWORD_URL,
                params={
                    "query": keyword,
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


def merge_live_place(
    doc: dict[str, Any],
    trend_lookup: dict[tuple[str, str], list[str]],
    existing_place: dict[str, Any] | None,
) -> dict[str, Any]:
    address = doc.get("road_address_name") or doc.get("address_name") or ""
    key = (normalize_text(doc.get("place_name", "")), normalize_text(address))
    existing_trends = existing_place.get("trend_names", []) if existing_place else []
    trend_names = trend_lookup.get(key, existing_trends)
    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        "external_place_id": str(doc["id"]),
        "name": doc["place_name"],
        "address": address,
        "lat": float(doc["y"]),
        "lng": float(doc["x"]),
        "phone": doc.get("phone") or None,
        "place_url": doc.get("place_url") or None,
        "category_name": doc.get("category_name") or CATEGORY_CONFIG["all"]["label"],
        "category_slug": infer_category_slug(doc.get("category_name") or ""),
        "rating": existing_place.get("rating") if existing_place else None,
        "quality_score": existing_place.get("quality_score") if existing_place else None,
        "trend_names": trend_names,
        "raw_payload": doc,
        "first_seen_at": existing_place.get("first_seen_at") if existing_place else now_iso,
        "last_seen_at": now_iso,
        "last_enriched_at": existing_place.get("last_enriched_at") if existing_place else None,
    }


def distance_score(distance_m: int, radius_m: int) -> float:
    if radius_m <= 0:
        return 1.0
    return max(0.0, 1 - min(distance_m / radius_m, 1))


def rating_score(rating: float | None) -> float:
    if rating is None:
        return 0.45
    return max(0.0, min(rating / 5, 1.0))


def recency_score(last_enriched_at: str | None, last_seen_at: str | None) -> float:
    reference = parse_iso_datetime(last_enriched_at) or parse_iso_datetime(last_seen_at)
    if reference is None:
        return 0.6

    age = datetime.now(timezone.utc) - reference
    normalized = min(age.total_seconds() / (7 * 24 * 3600), 1.0)
    return max(0.2, 1 - normalized)


def compute_quality_score(place: dict[str, Any], radius_m: int) -> float:
    distance_component = distance_score(place["distance_m"], radius_m) * 45
    rating_component = rating_score(place.get("rating")) * 35
    trend_component = (1 if place.get("trend_names") else 0) * 10
    recency_component = recency_score(
        place.get("last_enriched_at"),
        place.get("last_seen_at"),
    ) * 5
    jitter_component = random.random() * 5
    return round(
        distance_component
        + rating_component
        + trend_component
        + recency_component
        + jitter_component,
        3,
    )


def apply_quality_gate(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(candidates) < 10:
        return candidates

    filtered = [
        candidate
        for candidate in candidates
        if candidate.get("rating") is not None or candidate.get("trend_names")
    ]
    return filtered or candidates


def weighted_sample_without_replacement(
    candidates: list[dict[str, Any]],
    count: int,
) -> list[dict[str, Any]]:
    remaining = candidates.copy()
    winners: list[dict[str, Any]] = []

    while remaining and len(winners) < count:
        weights = [max(candidate["quality_score"], 0.01) for candidate in remaining]
        winner = random.choices(remaining, weights=weights, k=1)[0]
        winners.append(winner)
        remaining = [candidate for candidate in remaining if candidate["id"] != winner["id"]]

    return winners


def build_reel(candidates: list[dict[str, Any]], winner: dict[str, Any]) -> list[dict[str, Any]]:
    if not candidates:
        return [winner]

    pool = candidates[: min(len(candidates), 8)]
    reel = [random.choice(pool) for _ in range(11)]
    reel.append(winner)
    return reel


def build_response_item(place: dict[str, Any], requested_slug: str) -> dict[str, Any]:
    return {
        "place_id": place["id"],
        "name": place["name"],
        "address": place["address"],
        "category_label": extract_category_label(
            place.get("category_name") or "",
            CATEGORY_CONFIG[requested_slug]["label"],
        ),
        "distance_m": place["distance_m"],
        "rating": float(place["rating"]) if place.get("rating") is not None else None,
        "trend_names": place.get("trend_names", []),
        "place_url": place.get("place_url")
        or f"https://map.kakao.com/link/search/{place['name']}",
    }


def to_place_row(place: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in place.items() if key != "distance_m"}


async def find_yomechu_candidates(
    lat: float,
    lng: float,
    radius_m: int,
    category_slug: str,
    result_count: int,
) -> tuple[list[dict[str, Any]], bool]:
    config = CATEGORY_CONFIG[category_slug]
    keyword = config.get("keyword")

    if keyword:
        requested = await fetch_keyword_places(keyword, lat, lng, radius_m)
    else:
        requested = await fetch_category_places(config["group_code"], lat, lng, radius_m)

    used_fallback = False
    if len(requested) == 0:
        requested = await fetch_category_places(
            CATEGORY_CONFIG["all"]["group_code"], lat, lng, radius_m
        )
        used_fallback = True

    if not requested:
        raise YomechuNoResultsError("근처에서 조건에 맞는 매장을 찾지 못했습니다.")

    trend_lookup = get_trend_lookup()
    external_ids = [str(doc["id"]) for doc in requested]
    existing_rows = {
        row["external_place_id"]: row
        for row in get_yomechu_places_by_external_ids(external_ids)
    }

    merged_places: list[dict[str, Any]] = []
    for doc in requested:
        existing = existing_rows.get(str(doc["id"]))
        merged = merge_live_place(doc, trend_lookup, existing)
        merged["distance_m"] = int(doc.get("distance") or 0)
        merged_places.append(merged)

    merged_places = apply_quality_gate(merged_places)
    if not merged_places:
        raise YomechuNoResultsError("추천 후보를 충분히 찾지 못했습니다.")

    for place in merged_places:
        place["quality_score"] = compute_quality_score(place, radius_m)

    upsert_yomechu_places([to_place_row(place) for place in merged_places])
    refreshed_rows = {
        row["external_place_id"]: row
        for row in get_yomechu_places_by_external_ids(
            [place["external_place_id"] for place in merged_places]
        )
    }

    candidates: list[dict[str, Any]] = []
    for place in merged_places:
        refreshed = refreshed_rows.get(place["external_place_id"])
        if not refreshed:
            continue
        candidates.append(
            {
                **refreshed,
                "distance_m": place["distance_m"],
                "quality_score": place["quality_score"],
                "trend_names": place.get("trend_names", refreshed.get("trend_names", [])),
            }
        )

    candidates.sort(key=lambda item: item["quality_score"], reverse=True)
    return candidates, used_fallback


async def spin_yomechu(
    lat: float,
    lng: float,
    radius_m: int,
    category_slug: str,
    result_count: int,
    session_id: str | None,
) -> dict[str, Any]:
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
        raise YomechuNoResultsError("추천 후보가 없습니다.")

    pool = candidates[: min(len(candidates), 15)]
    winners = weighted_sample_without_replacement(pool, result_count)
    primary_winner = winners[0]
    reel = build_reel(pool, primary_winner)

    spin_row = insert_yomechu_spin(
        {
            "session_id": session_id,
            "lat_rounded": round(lat, 3),
            "lng_rounded": round(lng, 3),
            "radius_m": radius_m,
            "category_slug": category_slug,
            "pool_size": len(candidates),
            "used_fallback": used_fallback,
            "winner_place_id": primary_winner["id"],
            "reel_place_ids": [item["id"] for item in reel],
        }
    )

    return {
        "spin_id": spin_row["id"] if spin_row else None,
        "pool_size": len(candidates),
        "used_fallback": used_fallback,
        "result_count": len(winners),
        "reel": [build_response_item(item, category_slug) for item in reel],
        "winner": build_response_item(primary_winner, category_slug),
        "winners": [build_response_item(item, category_slug) for item in winners],
    }


async def refresh_recent_yomechu_ratings() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    eligible_rows = []
    for row in list_recent_yomechu_places(settings.YOMECHU_ENRICH_BATCH_SIZE):
        last_enriched = parse_iso_datetime(row.get("last_enriched_at"))
        if (
            row.get("rating") is not None
            and last_enriched
            and last_enriched > now - timedelta(days=1)
        ):
            continue
        if (
            last_enriched
            and last_enriched > now - timedelta(hours=settings.YOMECHU_ENRICH_INTERVAL_HOURS)
        ):
            continue
        eligible_rows.append(row)

    updated = 0
    scanned = 0
    async with httpx.AsyncClient() as client:
        for row in eligible_rows[: settings.YOMECHU_ENRICH_BATCH_SIZE]:
            scanned += 1
            rating = await fetch_naver_rating(client, row["name"])
            payload: dict[str, Any] = {"last_enriched_at": now.isoformat()}
            if rating is not None:
                payload["rating"] = rating
                updated += 1
            update_yomechu_place(row["id"], payload)

    logger.info("요메추 평점 보강 완료: scanned=%s updated=%s", scanned, updated)
    return {"scanned": scanned, "updated": updated}
