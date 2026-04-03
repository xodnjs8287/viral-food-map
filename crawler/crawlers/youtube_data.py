from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

YOUTUBE_SEARCH_API_URL = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos"

DEFAULT_DISCOVERY_QUERIES = (
    "요즘 뜨는 음식",
    "요즘 디저트",
    "유행 음식",
    "유행 디저트",
    "카페 신메뉴",
    "편의점 신상 음식",
)


@dataclass(slots=True)
class YouTubeLeadVideo:
    video_id: str
    title: str
    description: str
    published_at: str
    url: str
    query: str
    view_count: int
    like_count: int
    comment_count: int
    score: float


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _build_queries() -> list[str]:
    raw = settings.YOUTUBE_DISCOVERY_QUERIES.strip()
    if not raw:
        return list(DEFAULT_DISCOVERY_QUERIES)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _published_after() -> str:
    published_after = datetime.now(timezone.utc) - timedelta(
        hours=settings.YOUTUBE_DISCOVERY_LOOKBACK_HOURS
    )
    return published_after.isoformat().replace("+00:00", "Z")


def _score_video(video: dict[str, Any]) -> float:
    view_count = _safe_int(video.get("view_count"))
    like_count = _safe_int(video.get("like_count"))
    comment_count = _safe_int(video.get("comment_count"))

    freshness_score = 0.0
    published_at = str(video.get("published_at") or "").strip()
    if published_at:
        try:
            published_dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
            age_hours = max(
                (datetime.now(timezone.utc) - published_dt).total_seconds() / 3600,
                1.0,
            )
            freshness_score = min(72.0 / age_hours, 12.0)
        except ValueError:
            freshness_score = 0.0

    reach_score = min(math.log10(max(view_count, 1)), 6.0)
    engagement_score = min(math.log10(max(like_count + (comment_count * 2), 1)), 5.0)
    return round(freshness_score + reach_score + engagement_score, 2)


async def _search_videos_for_query(
    client: httpx.AsyncClient,
    *,
    query: str,
    published_after: str,
) -> list[str]:
    params = {
        "key": settings.YOUTUBE_API_KEY,
        "part": "snippet",
        "type": "video",
        "q": query,
        "order": "date",
        "maxResults": settings.YOUTUBE_DISCOVERY_RESULTS_PER_QUERY,
        "publishedAfter": published_after,
        "videoDuration": "short",
        "regionCode": settings.YOUTUBE_DISCOVERY_REGION_CODE,
        "relevanceLanguage": settings.YOUTUBE_DISCOVERY_LANGUAGE,
    }

    response = await client.get(YOUTUBE_SEARCH_API_URL, params=params)
    response.raise_for_status()
    items = response.json().get("items", [])
    return [
        item.get("id", {}).get("videoId", "")
        for item in items
        if item.get("id", {}).get("videoId")
    ]


async def _load_video_details(
    client: httpx.AsyncClient,
    *,
    video_ids: list[str],
) -> list[YouTubeLeadVideo]:
    if not video_ids:
        return []

    videos: list[YouTubeLeadVideo] = []

    for index in range(0, len(video_ids), 50):
        batch_ids = video_ids[index : index + 50]
        params = {
            "key": settings.YOUTUBE_API_KEY,
            "part": "snippet,statistics",
            "id": ",".join(batch_ids),
        }
        response = await client.get(YOUTUBE_VIDEOS_API_URL, params=params)
        response.raise_for_status()

        for item in response.json().get("items", []):
            video_id = str(item.get("id") or "").strip()
            if not video_id:
                continue

            snippet = item.get("snippet", {})
            statistics = item.get("statistics", {})
            title = " ".join(str(snippet.get("title", "")).split())
            description = " ".join(str(snippet.get("description", "")).split())
            video = {
                "view_count": _safe_int(statistics.get("viewCount")),
                "like_count": _safe_int(statistics.get("likeCount")),
                "comment_count": _safe_int(statistics.get("commentCount")),
                "published_at": str(snippet.get("publishedAt", "")).strip(),
            }
            videos.append(
                YouTubeLeadVideo(
                    video_id=video_id,
                    title=title,
                    description=description[:400],
                    published_at=video["published_at"],
                    url=f"https://www.youtube.com/watch?v={video_id}",
                    query="",
                    view_count=video["view_count"],
                    like_count=video["like_count"],
                    comment_count=video["comment_count"],
                    score=_score_video(video),
                )
            )

    return videos


async def collect_youtube_lead_videos() -> list[YouTubeLeadVideo]:
    if not settings.YOUTUBE_DISCOVERY_ENABLED:
        return []

    queries = _build_queries()
    if not queries:
        return []

    published_after = _published_after()
    video_ids_by_query: dict[str, list[str]] = {}

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for query in queries:
                video_ids_by_query[query] = await _search_videos_for_query(
                    client,
                    query=query,
                    published_after=published_after,
                )

            deduped_ids: list[str] = []
            seen_ids: set[str] = set()
            for ids in video_ids_by_query.values():
                for video_id in ids:
                    if video_id in seen_ids:
                        continue
                    seen_ids.add(video_id)
                    deduped_ids.append(video_id)

            videos = await _load_video_details(client, video_ids=deduped_ids)
    except httpx.HTTPStatusError as exc:
        logger.warning("YouTube discovery request failed with status %s", exc.response.status_code)
        return []
    except Exception as exc:
        logger.warning("YouTube discovery failed: %s", exc)
        return []

    query_lookup = {
        video_id: query
        for query, ids in video_ids_by_query.items()
        for video_id in ids
        if video_id
    }
    for video in videos:
        video.query = query_lookup.get(video.video_id, "")

    videos.sort(key=lambda item: item.score, reverse=True)
    return videos[: settings.YOUTUBE_DISCOVERY_MAX_VIDEOS]
