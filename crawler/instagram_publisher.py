from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx

from ai_reviewer import (
    InstagramImageReviewResult,
    is_ai_review_enabled,
    review_instagram_post_image,
)
from config import settings
from notifications import send_discord_message
from database import (
    create_instagram_feed_run,
    get_client,
    get_instagram_feed_run_by_date,
    list_published_instagram_trend_ids,
    update_instagram_feed_run,
)

logger = logging.getLogger(__name__)

KST = ZoneInfo(settings.SCHEDULER_TIMEZONE)
DEFAULT_GRAPH_API_BASE_URL = "https://graph.instagram.com"
FALLBACK_GRAPH_API_BASE_URL = "https://graph.facebook.com"
MAX_ERROR_MESSAGES = 5


def _now_kst() -> datetime:
    return datetime.now(KST)


def _today_run_date() -> str:
    return _now_kst().date().isoformat()


def _parse_detected_at(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)

    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_hashtag(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-z가-힣]+", "", value or "")
    return normalized or "요즘뭐먹"


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-z]+", "-", value.strip())
    normalized = normalized.strip("-").lower()
    return normalized or hashlib.sha256(value.encode()).hexdigest()[:8]


def _truncate_text(value: str, max_length: int = 24) -> str:
    compact = " ".join((value or "").split())
    if len(compact) <= max_length:
        return compact
    return f"{compact[: max_length - 1]}…"


def _truncate_error_text(value: str, max_length: int = 400) -> str:
    compact = " ".join((value or "").split())
    if len(compact) <= max_length:
        return compact
    return f"{compact[: max_length - 1]}…"


def _candidate_graph_api_base_urls() -> list[str]:
    urls = [
        DEFAULT_GRAPH_API_BASE_URL,
        FALLBACK_GRAPH_API_BASE_URL,
    ]
    unique_urls: list[str] = []
    for url in urls:
        if url not in unique_urls:
            unique_urls.append(url)
    return unique_urls


def _build_caption(trend: dict[str, Any]) -> str:
    name = trend["name"]
    category = trend.get("category") or "간식"
    description = trend.get("description") or (
        f"{category} 카테고리에서 검색량이 오른 메뉴예요."
    )
    hashtags = [
        "#요즘뭐먹",
        f"#{_normalize_hashtag(name)}",
        "#급상승음식",
        "#바이럴음식",
        "#오늘뭐먹지",
    ]
    return "\n\n".join(
        [
            f"오늘의 급상승 음식: {name}",
            description,
            f"요즘뭐먹 프로필 링크와 {settings.INSTAGRAM_LINK_HUB_URL}에서 판매처 지도를 확인해보세요.",
            " ".join(hashtags),
        ]
    )


def _build_render_subtitle(trend: dict[str, Any]) -> str:
    description = trend.get("description")
    if description:
        return _truncate_text(description, max_length=24)

    category = trend.get("category") or "간식"
    return _truncate_text(f"{category} 카테고리에서 검색량이 오른 메뉴", max_length=24)


def _build_badge_label(status: str | None) -> str:
    return "인기" if status == "active" else "급상승"


def _is_instagram_image_review_accepted(review: InstagramImageReviewResult) -> bool:
    return (
        review.verdict == "accept"
        and review.confidence >= settings.INSTAGRAM_IMAGE_REVIEW_MIN_CONFIDENCE
    )


def _build_instagram_image_review_message(review: InstagramImageReviewResult) -> str:
    parts = [
        f"ai_image_review={review.verdict}",
        f"confidence={review.confidence:.2f}",
    ]
    if review.detected_subject:
        parts.append(f"subject={review.detected_subject}")
    if review.reason:
        parts.append(f"reason={review.reason}")
    if review.concerns:
        parts.append(f"concerns={', '.join(review.concerns)}")
    return " | ".join(parts)


def _serialize_image_review(
    review: InstagramImageReviewResult | None,
) -> dict[str, Any] | None:
    if review is None:
        return None

    return {
        "verdict": review.verdict,
        "confidence": review.confidence,
        "reason": review.reason,
        "detected_subject": review.detected_subject,
        "concerns": review.concerns or [],
        "model": review.model,
    }


def _serialize_candidate(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "status": row.get("status"),
        "category": row.get("category"),
        "peak_score": row.get("peak_score"),
        "detected_at": row.get("detected_at"),
        "store_count": row.get("store_count"),
        "image_url": row.get("image_url"),
    }


def _list_candidate_trends() -> list[dict[str, Any]]:
    rows = (
        get_client()
        .table("trends")
        .select(
            "id,name,category,description,image_url,status,peak_score,detected_at,stores(count)"
        )
        .in_("status", ["rising", "active"])
        .order("peak_score", desc=True)
        .order("detected_at", desc=True)
        .execute()
        .data
    ) or []

    published_trend_ids = set(list_published_instagram_trend_ids())
    candidates: list[dict[str, Any]] = []

    for row in rows:
        trend_id = row.get("id")
        if not trend_id or trend_id in published_trend_ids:
            continue

        stores = row.get("stores") or []
        store_count = stores[0].get("count", 0) if stores else 0
        if store_count <= 0:
            continue

        candidate = dict(row)
        candidate["store_count"] = int(store_count)
        candidates.append(candidate)

    rising = [row for row in candidates if row.get("status") == "rising"]
    active = [row for row in candidates if row.get("status") == "active"]
    selected_group = rising or active

    return sorted(
        selected_group,
        key=lambda row: (
            -(float(row.get("peak_score") or 0)),
            -_parse_detected_at(row.get("detected_at")).timestamp(),
            -(int(row.get("store_count") or 0)),
        ),
    )


def _prepare_running_payload(run_date: str) -> dict[str, Any]:
    return {
        "run_date": run_date,
        "status": "running",
        "trend_id": None,
        "trend_name_snapshot": None,
        "candidate_status": None,
        "caption": None,
        "source_image_url": None,
        "final_image_url": None,
        "instagram_creation_id": None,
        "instagram_media_id": None,
        "skip_reason": None,
        "error_message": None,
        "published_at": None,
    }


def _read_renderer_result(stdout: str) -> dict[str, Any]:
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Renderer completed without stdout")
    return json.loads(lines[-1])


async def _render_instagram_card(
    trend: dict[str, Any],
) -> tuple[bytes, dict[str, Any]]:
    with tempfile.TemporaryDirectory(prefix="instagram-card-") as temp_dir:
        temp_path = Path(temp_dir)
        output_path = temp_path / "instagram-card.jpg"
        payload_path = temp_path / "renderer-payload.json"

        payload = {
            "outputPath": str(output_path),
            "title": trend["name"],
            "subtitle": _build_render_subtitle(trend),
            "badge": _build_badge_label(trend.get("status")),
            "eyebrow": "오늘의 급상승 음식",
            "brandLabel": "요즘뭐먹",
            "status": trend.get("status") or "rising",
            "category": trend.get("category") or "",
            "imageUrl": trend.get("image_url") or "",
        }
        payload_path.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )

        process = await asyncio.create_subprocess_exec(
            "node",
            "scripts/render_instagram_card.mjs",
            "--payload",
            str(payload_path),
            cwd=str(Path(__file__).resolve().parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            raise RuntimeError(f"Renderer failed: {stderr.decode()}")

        if not output_path.exists():
            raise RuntimeError("Renderer completed without producing an output file")

        return output_path.read_bytes(), _read_renderer_result(stdout.decode())


def _upload_instagram_media(
    image_bytes: bytes, run_date: str, trend_name: str
) -> tuple[str, str]:
    object_path = (
        f"feed/{run_date}/{_now_kst().strftime('%H%M%S')}-{uuid4().hex[:4]}-{_slugify(trend_name)}.jpg"
    )
    bucket = get_client().storage.from_(settings.INSTAGRAM_MEDIA_BUCKET)
    bucket.upload(
        object_path,
        image_bytes,
        {
            "content-type": "image/jpeg",
            "cache-control": "3600",
            "upsert": "true",
        },
    )
    return bucket.get_public_url(object_path).rstrip("?"), object_path


def _delete_instagram_media(object_path: str) -> None:
    try:
        bucket = get_client().storage.from_(settings.INSTAGRAM_MEDIA_BUCKET)
        bucket.remove([object_path])
    except Exception as exc:
        logger.warning("Failed to delete rejected image %s: %s", object_path, exc)


def _extract_graph_error_payload(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception:
        return {"raw_text": _truncate_error_text(response.text)}

    if not isinstance(payload, dict):
        return {"raw_text": _truncate_error_text(str(payload))}

    error = payload.get("error")
    if isinstance(error, dict):
        return {
            "message": _truncate_error_text(str(error.get("message") or "")),
            "type": str(error.get("type") or "").strip(),
            "code": error.get("code"),
            "error_subcode": error.get("error_subcode"),
            "fbtrace_id": str(error.get("fbtrace_id") or "").strip(),
        }

    return {"raw_text": _truncate_error_text(json.dumps(payload, ensure_ascii=False))}


def _build_graph_error_message(exc: httpx.HTTPStatusError) -> str:
    response = exc.response
    payload = _extract_graph_error_payload(response)
    parts = [f"status={response.status_code}"]
    request_url = getattr(exc.request, "url", None)

    if request_url and getattr(request_url, "host", None):
        parts.insert(0, f"host={request_url.host}")

    error_type = payload.get("type")
    if error_type:
        parts.append(f"type={error_type}")

    error_code = payload.get("code")
    if error_code not in (None, ""):
        parts.append(f"code={error_code}")

    error_subcode = payload.get("error_subcode")
    if error_subcode not in (None, ""):
        parts.append(f"subcode={error_subcode}")

    message = payload.get("message")
    if message:
        parts.append(f"message={message}")
    elif payload.get("raw_text"):
        parts.append(f"body={payload['raw_text']}")

    fbtrace_id = payload.get("fbtrace_id")
    if fbtrace_id:
        parts.append(f"fbtrace_id={fbtrace_id}")

    return " | ".join(parts)


def _is_graph_auth_error(exc: httpx.HTTPStatusError) -> bool:
    if exc.response.status_code == 401:
        return True

    payload = _extract_graph_error_payload(exc.response)
    error_code = payload.get("code")
    if error_code in {190, "190", 102, "102"}:
        return True

    message = str(payload.get("message") or "").lower()
    return "access token" in message


async def _create_media_container(image_url: str, caption: str) -> tuple[str, str]:
    async with httpx.AsyncClient(timeout=30) as client:
        last_auth_error: httpx.HTTPStatusError | None = None
        for base_url in _candidate_graph_api_base_urls():
            try:
                response = await client.post(
                    f"{base_url}/{settings.INSTAGRAM_GRAPH_API_VERSION}/{settings.INSTAGRAM_IG_USER_ID}/media",
                    data={
                        "image_url": image_url,
                        "caption": caption,
                        "access_token": settings.INSTAGRAM_ACCESS_TOKEN,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                if _is_graph_auth_error(exc):
                    last_auth_error = exc
                    logger.warning(
                        "Instagram Graph host %s rejected the access token while creating a media container",
                        base_url,
                    )
                    await send_discord_message(f"[⚠️ 인스타그램] Graph API 인증 거부 (host: {base_url})")
                    continue
                raise

            payload = response.json()
            creation_id = payload.get("id")
            if not creation_id:
                raise RuntimeError(
                    "Instagram media container response did not include id"
                )
            return creation_id, base_url

        if last_auth_error:
            raise last_auth_error

    raise RuntimeError("Failed to create Instagram media container")


async def _wait_for_container_ready(creation_id: str, graph_api_base_url: str) -> None:
    deadline = (
        datetime.now(timezone.utc).timestamp()
        + settings.INSTAGRAM_CONTAINER_STATUS_TIMEOUT_SECONDS
    )

    async with httpx.AsyncClient(timeout=15) as client:
        while datetime.now(timezone.utc).timestamp() < deadline:
            response = await client.get(
                f"{graph_api_base_url}/{settings.INSTAGRAM_GRAPH_API_VERSION}/{creation_id}",
                params={
                    "fields": "status_code",
                    "access_token": settings.INSTAGRAM_ACCESS_TOKEN,
                },
            )
            response.raise_for_status()
            status_code = response.json().get("status_code")
            if status_code == "FINISHED":
                return
            if status_code in {"ERROR", "EXPIRED"}:
                raise RuntimeError(
                    f"Instagram media container failed with status {status_code}"
                )
            await asyncio.sleep(settings.INSTAGRAM_CONTAINER_STATUS_POLL_SECONDS)

    raise TimeoutError("Timed out while waiting for Instagram media container")


async def _publish_media_container(creation_id: str, graph_api_base_url: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{graph_api_base_url}/{settings.INSTAGRAM_GRAPH_API_VERSION}/{settings.INSTAGRAM_IG_USER_ID}/media_publish",
            data={
                "creation_id": creation_id,
                "access_token": settings.INSTAGRAM_ACCESS_TOKEN,
            },
        )
        response.raise_for_status()
        payload = response.json()
        media_id = payload.get("id")
        if not media_id:
            raise RuntimeError("Instagram publish response did not include id")
        return media_id


def _build_noop_summary(
    run_date: str,
    reason: str,
    run: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "run_date": run_date,
        "status": "noop",
        "reason": reason,
        "run": run,
    }


def _ensure_instagram_ready() -> None:
    if not settings.INSTAGRAM_POSTING_ENABLED:
        raise RuntimeError("Instagram posting is disabled")
    if not settings.INSTAGRAM_IG_USER_ID.strip():
        raise RuntimeError("INSTAGRAM_IG_USER_ID is required")
    if not settings.INSTAGRAM_ACCESS_TOKEN.strip():
        raise RuntimeError("INSTAGRAM_ACCESS_TOKEN is required")
    if settings.INSTAGRAM_IMAGE_REVIEW_ENABLED and not is_ai_review_enabled():
        raise RuntimeError(
            "INSTAGRAM_IMAGE_REVIEW_ENABLED requires AI review credentials and model"
        )


async def publish_daily_instagram_feed(
    *,
    trigger: str = "scheduler",
    dry_run: bool = False,
    force_retry: bool = False,
) -> dict[str, Any]:
    run_date = _today_run_date()
    candidates = _list_candidate_trends()
    candidate_preview = [_serialize_candidate(row) for row in candidates[:5]]
    run_row: dict[str, Any] | None = None

    if dry_run:
        return {
            "run_date": run_date,
            "status": "dry_run",
            "candidate_count": len(candidates),
            "selected_scope": candidates[0]["status"] if candidates else None,
            "candidates": candidate_preview,
            "image_review_enabled": settings.INSTAGRAM_IMAGE_REVIEW_ENABLED,
            "trigger": trigger,
        }

    _ensure_instagram_ready()

    existing_run = get_instagram_feed_run_by_date(run_date)
    if existing_run:
        existing_status = existing_run.get("status")
        if existing_status == "published":
            return _build_noop_summary(run_date, "already_completed", existing_run)
        if existing_status == "skipped" and not force_retry:
            return _build_noop_summary(run_date, "already_completed", existing_run)
        if existing_status == "failed" and not force_retry:
            return _build_noop_summary(
                run_date,
                "failed_requires_force_retry",
                existing_run,
            )
        if existing_status == "running" and not force_retry:
            return _build_noop_summary(run_date, "already_running", existing_run)

    try:
        run_row = (
            update_instagram_feed_run(existing_run["id"], _prepare_running_payload(run_date))
            if existing_run
            else create_instagram_feed_run(_prepare_running_payload(run_date))
        )
        if not run_row:
            raise RuntimeError("Failed to create instagram feed run record")

        if not candidates:
            run_row = update_instagram_feed_run(
                run_row["id"],
                {
                    "status": "skipped",
                    "skip_reason": "no_candidates",
                    "error_message": None,
                },
            )
            return {
                "run_date": run_date,
                "status": "skipped",
                "candidate_count": 0,
                "skip_reason": "no_candidates",
                "run": run_row,
            }

        errors: list[str] = []
        for candidate in candidates:
            caption = _build_caption(candidate)
            image_review: InstagramImageReviewResult | None = None
            graph_api_base_url: str | None = None
            update_instagram_feed_run(
                run_row["id"],
                {
                    "trend_id": candidate.get("id"),
                    "trend_name_snapshot": candidate.get("name"),
                    "candidate_status": candidate.get("status"),
                    "caption": caption,
                    "source_image_url": candidate.get("image_url"),
                    "final_image_url": None,
                    "instagram_creation_id": None,
                    "instagram_media_id": None,
                    "skip_reason": None,
                    "error_message": None,
                },
            )

            object_path: str | None = None
            try:
                image_bytes, render_metadata = await _render_instagram_card(candidate)
                final_image_url, object_path = _upload_instagram_media(
                    image_bytes,
                    run_date,
                    candidate["name"],
                )
                if settings.INSTAGRAM_IMAGE_REVIEW_ENABLED:
                    image_review = await review_instagram_post_image(
                        image_url=final_image_url,
                        trend_name=candidate["name"],
                        category=candidate.get("category"),
                        caption=caption,
                    )
                    if not _is_instagram_image_review_accepted(image_review):
                        review_message = _build_instagram_image_review_message(image_review)
                        logger.info(
                            "Instagram image review blocked %s: %s",
                            candidate.get("name"),
                            review_message,
                        )
                        _delete_instagram_media(object_path)
                        update_instagram_feed_run(
                            run_row["id"],
                            {
                                "skip_reason": "ai_image_review_rejected",
                                "error_message": review_message,
                            },
                        )
                        errors.append(f"{candidate.get('name')}: {review_message}")
                        continue
                creation_id, graph_api_base_url = await _create_media_container(
                    final_image_url,
                    caption,
                )
                await _wait_for_container_ready(creation_id, graph_api_base_url)
                media_id = await _publish_media_container(
                    creation_id,
                    graph_api_base_url,
                )

                run_row = update_instagram_feed_run(
                    run_row["id"],
                    {
                        "status": "published",
                        "trend_id": candidate.get("id"),
                        "trend_name_snapshot": candidate.get("name"),
                        "candidate_status": candidate.get("status"),
                        "caption": caption,
                        "source_image_url": candidate.get("image_url"),
                        "final_image_url": final_image_url,
                        "instagram_creation_id": creation_id,
                        "instagram_media_id": media_id,
                        "skip_reason": None,
                        "error_message": render_metadata.get("photoLoadError"),
                        "published_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                return {
                    "run_date": run_date,
                    "status": "published",
                    "candidate_count": len(candidates),
                    "published_trend": _serialize_candidate(candidate),
                    "final_image_url": final_image_url,
                    "instagram_creation_id": creation_id,
                    "instagram_media_id": media_id,
                    "graph_api_host": graph_api_base_url,
                    "image_review": _serialize_image_review(image_review),
                    "image_review_enabled": settings.INSTAGRAM_IMAGE_REVIEW_ENABLED,
                    "used_fallback_image": bool(render_metadata.get("usedFallback")),
                    "run": run_row,
                }
            except httpx.HTTPStatusError as exc:
                error_message = _build_graph_error_message(exc)
                logger.warning(
                    "Instagram publishing candidate failed for %s: %s",
                    candidate.get("name"),
                    error_message,
                )
                errors.append(f"{candidate.get('name')}: {error_message}")
                await send_discord_message(f"[⚠️ 인스타그램 발행 실패] {candidate.get('name')}: {error_message}")
                if object_path:
                    _delete_instagram_media(object_path)
                if _is_graph_auth_error(exc):
                    logger.error("Instagram token invalid, aborting candidate loop")
                    break
                continue
            except Exception as exc:
                logger.warning(
                    "Instagram publishing candidate failed for %s: %s",
                    candidate.get("name"),
                    exc,
                )
                errors.append(f"{candidate.get('name')}: {exc}")
                await send_discord_message(f"[⚠️ 인스타그램 발행 실패] {candidate.get('name')}: {exc}")
                if object_path:
                    _delete_instagram_media(object_path)
                continue

        run_row = update_instagram_feed_run(
            run_row["id"],
            {
                "status": "skipped",
                "skip_reason": "all_candidates_failed",
                "error_message": "\n".join(errors[:MAX_ERROR_MESSAGES]),
            },
        )
        return {
            "run_date": run_date,
            "status": "skipped",
            "candidate_count": len(candidates),
            "skip_reason": "all_candidates_failed",
            "errors": errors[:MAX_ERROR_MESSAGES],
            "run": run_row,
        }
    except Exception as exc:
        if run_row:
            update_instagram_feed_run(
                run_row["id"],
                {
                    "status": "failed",
                    "error_message": str(exc),
                },
            )
        raise
