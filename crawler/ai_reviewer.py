from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

VALID_CATEGORIES = ("디저트", "음료", "식사", "간식", "기타")
VALID_VERDICTS = ("accept", "reject", "review")


class AIReviewError(RuntimeError):
    """Raised when the AI review service cannot be used safely."""


@dataclass(slots=True)
class TrendReviewPayload:
    keyword: str
    acceleration: float
    search_volume_data: dict[str, float]
    blog_count: int
    ig_count: int | None
    category_hint: str
    evidence_snippets: list[str]


@dataclass(slots=True)
class DiscoveryReviewPayload:
    keyword: str
    frequency: int
    food_ratio: float
    category_hint: str
    evidence_snippets: list[str]


@dataclass(slots=True)
class TrendReviewResult:
    verdict: str
    confidence: float
    category: str
    reason: str
    canonical_keyword: str | None = None
    model: str | None = None


def is_ai_review_enabled() -> bool:
    return bool(
        settings.AI_REVIEW_ENABLED
        and settings.AI_REVIEW_API_KEY.strip()
        and settings.AI_REVIEW_MODEL.strip()
    )


def _build_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.AI_REVIEW_API_KEY}",
        "Content-Type": "application/json",
    }


def _normalize_verdict(value: Any) -> str:
    verdict = str(value or "").strip().lower()
    return verdict if verdict in VALID_VERDICTS else "review"


def _normalize_category(value: Any, fallback: str = "기타") -> str:
    category = str(value or "").strip()
    return category if category in VALID_CATEGORIES else fallback


def _normalize_keyword(value: Any, original_keyword: str) -> str | None:
    keyword = re.sub(r"\s+", " ", str(value or "")).strip()
    if not keyword or keyword == original_keyword:
        return None
    return keyword


def _extract_json_blob(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if not stripped:
        raise AIReviewError("empty AI response")

    try:
        data = json.loads(stripped)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", stripped, re.DOTALL)
    if not match:
        raise AIReviewError("no JSON object found in AI response")

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise AIReviewError("invalid JSON object in AI response") from exc

    if not isinstance(data, dict):
        raise AIReviewError("AI response JSON must be an object")
    return data


def _extract_message_content(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise AIReviewError("AI response missing choices")

    message = choices[0].get("message", {})
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                text = block.get("text")
                if text:
                    parts.append(str(text))
        return "\n".join(parts)
    return str(content)


def _coerce_result(
    raw: dict[str, Any],
    *,
    original_keyword: str,
    fallback_category: str,
) -> TrendReviewResult:
    try:
        confidence = float(raw.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(confidence, 1.0))

    reason = " ".join(str(raw.get("reason", "")).split())
    if not reason:
        reason = "No review reason provided."

    return TrendReviewResult(
        verdict=_normalize_verdict(raw.get("verdict")),
        confidence=confidence,
        category=_normalize_category(raw.get("category"), fallback=fallback_category),
        reason=reason[:200],
        canonical_keyword=_normalize_keyword(
            raw.get("canonical_keyword"),
            original_keyword=original_keyword,
        ),
        model=settings.AI_REVIEW_MODEL,
    )


async def _request_review(
    *,
    system_prompt: str,
    payload: dict[str, Any],
    original_keyword: str,
    fallback_category: str,
) -> TrendReviewResult:
    if not is_ai_review_enabled():
        raise AIReviewError("AI review is disabled or missing credentials")

    body = {
        "model": settings.AI_REVIEW_MODEL,
        "temperature": 0.1,
        "max_tokens": 250,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False),
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=settings.AI_REVIEW_TIMEOUT_SECONDS) as client:
            response = await client.post(
                settings.AI_REVIEW_API_URL,
                headers=_build_headers(),
                json=body,
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise AIReviewError(
            f"AI review request failed with status {exc.response.status_code}"
        ) from exc
    except Exception as exc:
        raise AIReviewError(f"AI review request failed: {exc}") from exc

    raw = _extract_json_blob(_extract_message_content(response.json()))
    return _coerce_result(
        raw,
        original_keyword=original_keyword,
        fallback_category=fallback_category,
    )


async def review_trend_candidate(payload: TrendReviewPayload) -> TrendReviewResult:
    system_prompt = (
        "You are reviewing Korean viral food trend candidates for a store-finding service. "
        "Accept only if the keyword is a specific food, drink, dessert, snack, or menu concept "
        "that real users may search for and buy nearby right now. "
        "Reject keywords that are non-food, too generic, just a restaurant descriptor, a place, "
        "a person, a content format, a promotion phrase, or too ambiguous to attach stores to. "
        "Use review when it is food-related but too generic or uncertain for automatic approval. "
        "Category must be one of: 디저트, 음료, 식사, 간식, 기타. "
        "canonical_keyword should only normalize spacing or obvious synonym variants. "
        "Respond with JSON only using keys: verdict, confidence, category, reason, canonical_keyword."
    )
    result = await _request_review(
        system_prompt=system_prompt,
        payload=asdict(payload),
        original_keyword=payload.keyword,
        fallback_category=payload.category_hint,
    )
    logger.info(
        "AI reviewed trend '%s': verdict=%s confidence=%.2f category=%s",
        payload.keyword,
        result.verdict,
        result.confidence,
        result.category,
    )
    return result


async def review_discovered_keyword(
    payload: DiscoveryReviewPayload,
) -> TrendReviewResult:
    system_prompt = (
        "You are reviewing newly discovered Korean food keywords for a monitoring list. "
        "Accept only if the keyword is a distinct food or drink concept worth tracking as its own keyword. "
        "Reject keywords that are too generic, non-food, location terms, broad category names, marketing terms, "
        "or content trend words. Use review for borderline food keywords that should not be auto-added. "
        "Category must be one of: 디저트, 음료, 식사, 간식, 기타. "
        "canonical_keyword should only normalize spacing or obvious synonym variants. "
        "Respond with JSON only using keys: verdict, confidence, category, reason, canonical_keyword."
    )
    result = await _request_review(
        system_prompt=system_prompt,
        payload=asdict(payload),
        original_keyword=payload.keyword,
        fallback_category=payload.category_hint,
    )
    logger.info(
        "AI reviewed discovery keyword '%s': verdict=%s confidence=%.2f category=%s",
        payload.keyword,
        result.verdict,
        result.confidence,
        result.category,
    )
    return result
