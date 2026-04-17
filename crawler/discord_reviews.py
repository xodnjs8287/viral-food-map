from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from config import settings
from database import get_client
from detector.alias_manager import clean_display_keyword, normalize_keyword_text
from notifications.discord_bot import (
    DiscordBotError,
    DiscordBotNotFoundError,
    create_channel_message,
    edit_channel_message,
    is_discord_review_enabled,
)

logger = logging.getLogger(__name__)

ReviewEntityKind = Literal["ai_review", "ai_alias", "report"]
ReviewMessageState = Literal["active", "resolved", "stale", "failed"]
ReviewOutcome = Literal["success", "noop", "error"]
AliasDecision = Literal["merge", "separate", "reverse"]
QueueStatus = Literal["pending", "approved", "rejected", "applied"]

ACTION_ROW_TYPE = 1
BUTTON_COMPONENT_TYPE = 2
BUTTON_STYLE_PRIMARY = 1
BUTTON_STYLE_SECONDARY = 2
BUTTON_STYLE_SUCCESS = 3
BUTTON_STYLE_DANGER = 4

INTERACTION_TYPE_PING = 1
INTERACTION_RESPONSE_TYPE_PONG = 1
INTERACTION_RESPONSE_TYPE_CHANNEL_MESSAGE = 4
EPHEMERAL_FLAG = 1 << 6

AI_REVIEW_ENTITY_KINDS: tuple[ReviewEntityKind, ReviewEntityKind] = (
    "ai_review",
    "ai_alias",
)


@dataclass(slots=True)
class DiscordActor:
    discord_user_id: str
    discord_username: str
    channel_id: str
    message_id: str | None


@dataclass(slots=True)
class ActionExecutionResult:
    entity_kind: ReviewEntityKind
    entity_id: str
    action: str
    outcome: ReviewOutcome
    message: str
    metadata: dict[str, Any]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_decimal(value: float | int | None, digits: int = 1) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not numeric and digits == 0:
        return "0"
    return f"{numeric:.{digits}f}"


def _format_confidence(value: float | None) -> str | None:
    if value is None:
        return None
    return f"{value * 100:.0f}%"


def _get_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _get_string(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _get_string_array(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _get_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _score_breakdown(value: Any) -> dict[str, float]:
    record = _get_record(value)
    result: dict[str, float] = {}
    for key, entry in record.items():
        number = _get_number(entry)
        if number is not None and number > 0:
            result[str(key)] = number
    return result


def _queue_payload(row: dict[str, Any]) -> dict[str, Any]:
    return _get_record(row.get("payload"))


def _resolve_queue_entity_kind(row: dict[str, Any]) -> ReviewEntityKind:
    payload = _queue_payload(row)
    candidate_name = clean_display_keyword(row.get("candidate_name"))
    canonical_keyword = clean_display_keyword(payload.get("canonical_keyword"))
    if canonical_keyword and canonical_keyword != candidate_name:
        return "ai_alias"
    return "ai_review"


def _resolve_keyword_category(row: dict[str, Any]) -> str:
    payload = _queue_payload(row)
    return (
        _get_string(row.get("category"))
        or _get_string(payload.get("category"))
        or _get_string(payload.get("category_hint"))
        or "기타"
    )


def _resolve_trend_status(existing_status: str | None) -> str:
    if existing_status in {"active", "rising"}:
        return existing_status
    return "watchlist"


def _build_custom_id(entity_kind: ReviewEntityKind, action: str, entity_id: str) -> str:
    return f"review:{entity_kind}:{action}:{entity_id}"


def parse_custom_id(custom_id: str | None) -> tuple[ReviewEntityKind, str, str] | None:
    raw = (custom_id or "").strip()
    prefix, sep, rest = raw.partition(":")
    if prefix != "review" or not sep:
        return None

    entity_kind, sep, remainder = rest.partition(":")
    if entity_kind not in {"ai_review", "ai_alias", "report"} or not sep:
        return None

    action, sep, entity_id = remainder.partition(":")
    if not action or not sep or not entity_id.strip():
        return None

    return entity_kind, action, entity_id.strip()


def verify_interaction_signature(
    body: bytes,
    *,
    signature: str,
    timestamp: str,
) -> bool:
    public_key = settings.DISCORD_PUBLIC_KEY.strip()
    if not public_key:
        logger.warning("Discord interaction rejected because DISCORD_PUBLIC_KEY is missing")
        return False

    if not signature or not timestamp:
        return False

    try:
        verify_key = VerifyKey(bytes.fromhex(public_key))
        verify_key.verify(timestamp.encode("utf-8") + body, bytes.fromhex(signature))
        return True
    except (BadSignatureError, ValueError):
        return False


def build_ephemeral_response(content: str) -> dict[str, Any]:
    return {
        "type": INTERACTION_RESPONSE_TYPE_CHANNEL_MESSAGE,
        "data": {
            "content": content,
            "flags": EPHEMERAL_FLAG,
        },
    }


def _button(
    *,
    custom_id: str,
    label: str,
    style: int,
    disabled: bool = False,
) -> dict[str, Any]:
    return {
        "type": BUTTON_COMPONENT_TYPE,
        "style": style,
        "label": label,
        "custom_id": custom_id,
        "disabled": disabled,
    }


def _build_components(
    entity_kind: ReviewEntityKind,
    entity_id: str,
    *,
    disabled: bool,
    approve_disabled: bool = False,
) -> list[dict[str, Any]]:
    if entity_kind == "ai_review":
        buttons = [
            _button(
                custom_id=_build_custom_id(entity_kind, "approve", entity_id),
                label="승인",
                style=BUTTON_STYLE_SUCCESS,
                disabled=disabled,
            ),
            _button(
                custom_id=_build_custom_id(entity_kind, "reject", entity_id),
                label="거절",
                style=BUTTON_STYLE_DANGER,
                disabled=disabled,
            ),
        ]
    elif entity_kind == "ai_alias":
        buttons = [
            _button(
                custom_id=_build_custom_id(entity_kind, "merge", entity_id),
                label="묶기",
                style=BUTTON_STYLE_SUCCESS,
                disabled=disabled,
            ),
            _button(
                custom_id=_build_custom_id(entity_kind, "separate", entity_id),
                label="다른 상품",
                style=BUTTON_STYLE_SECONDARY,
                disabled=disabled,
            ),
            _button(
                custom_id=_build_custom_id(entity_kind, "reverse", entity_id),
                label="뒤집기",
                style=BUTTON_STYLE_PRIMARY,
                disabled=disabled,
            ),
        ]
    else:
        buttons = [
            _button(
                custom_id=_build_custom_id(entity_kind, "approve", entity_id),
                label="승인",
                style=BUTTON_STYLE_SUCCESS,
                disabled=disabled or approve_disabled,
            ),
            _button(
                custom_id=_build_custom_id(entity_kind, "reject", entity_id),
                label="거절",
                style=BUTTON_STYLE_DANGER,
                disabled=disabled,
            ),
        ]

    return [{"type": ACTION_ROW_TYPE, "components": buttons}]


def _resolution_lines(
    *,
    outcome_label: str | None,
    actor: DiscordActor | None,
    metadata: dict[str, Any] | None,
) -> list[str]:
    if not outcome_label:
        return []

    lines = [
        "",
        f"처리 결과: {outcome_label}",
    ]

    if actor is not None:
        lines.append(f"처리자: {actor.discord_username} ({actor.discord_user_id})")

    timestamp = metadata.get("resolved_at") if metadata else None
    if isinstance(timestamp, str) and timestamp:
        lines.append(f"처리 시각: {timestamp}")

    return lines


def _format_ai_review_content(
    row: dict[str, Any],
    *,
    outcome_label: str | None = None,
    actor: DiscordActor | None = None,
    metadata: dict[str, Any] | None = None,
    stale_reason: str | None = None,
) -> str:
    payload = _queue_payload(row)
    lines = [
        "[AI 보류]",
        f"후보명: {clean_display_keyword(row.get('candidate_name'))}",
        f"타입: {row.get('item_type')}",
        f"카테고리: {_resolve_keyword_category(row)}",
    ]

    confidence = _format_confidence(_get_number(row.get("confidence")))
    if confidence:
        lines.append(f"신뢰도: {confidence}")

    reason = _get_string(row.get("reason"))
    if reason:
        lines.append(f"사유: {reason}")

    source_job = _get_string(row.get("source_job"))
    if source_job:
        lines.append(f"출처 배치: {source_job}")

    trigger = _get_string(row.get("trigger"))
    if trigger:
        lines.append(f"트리거: {trigger}")

    model = _get_string(row.get("model"))
    if model:
        lines.append(f"모델: {model}")

    score = _format_decimal(_get_number(payload.get("score")), 0)
    if score:
        lines.append(f"총점: {score}")

    acceleration = _format_decimal(_get_number(payload.get("acceleration")), 1)
    if acceleration:
        lines.append(f"가속도: {acceleration}")

    novelty_lift = _format_decimal(_get_number(payload.get("novelty_lift")), 1)
    if novelty_lift:
        lines.append(f"신규성: {novelty_lift}%")

    raw_terms = _get_string_array(payload.get("raw_terms"))[:5]
    if raw_terms:
        lines.append(f"연관어: {', '.join(raw_terms)}")

    grounding_sources = _get_string_array(payload.get("grounding_sources"))[:3]
    if grounding_sources:
        lines.append(f"근거: {', '.join(grounding_sources)}")

    if stale_reason:
        lines.extend(["", stale_reason])
    else:
        lines.extend(_resolution_lines(outcome_label=outcome_label, actor=actor, metadata=metadata))

    return "\n".join(lines)


def _format_ai_alias_content(
    row: dict[str, Any],
    *,
    outcome_label: str | None = None,
    actor: DiscordActor | None = None,
    metadata: dict[str, Any] | None = None,
    stale_reason: str | None = None,
) -> str:
    payload = _queue_payload(row)
    candidate_name = clean_display_keyword(row.get("candidate_name"))
    canonical_keyword = clean_display_keyword(payload.get("canonical_keyword"))

    lines = [
        "[AI 동의어 보류]",
        f"후보명: {candidate_name}",
        f"대표명 제안: {canonical_keyword or '-'}",
        f"타입: {row.get('item_type')}",
    ]

    confidence = _format_confidence(_get_number(row.get("confidence")))
    if confidence:
        lines.append(f"신뢰도: {confidence}")

    reason = _get_string(row.get("reason"))
    if reason:
        lines.append(f"사유: {reason}")

    raw_terms = _get_string_array(payload.get("raw_terms"))[:5]
    if raw_terms:
        lines.append(f"연관어: {', '.join(raw_terms)}")

    source_job = _get_string(row.get("source_job"))
    if source_job:
        lines.append(f"출처 배치: {source_job}")

    if stale_reason:
        lines.extend(["", stale_reason])
    else:
        lines.extend(_resolution_lines(outcome_label=outcome_label, actor=actor, metadata=metadata))

    return "\n".join(lines)


def _format_report_content(
    report: dict[str, Any],
    *,
    outcome_label: str | None = None,
    actor: DiscordActor | None = None,
    metadata: dict[str, Any] | None = None,
    stale_reason: str | None = None,
) -> str:
    trend = _get_record(report.get("trends"))
    lines = [
        "[판매처 제보]",
        f"트렌드: {_get_string(trend.get('name')) or '-'}",
        f"매장명: {_get_string(report.get('store_name')) or '-'}",
        f"주소: {_get_string(report.get('address')) or '-'}",
    ]

    note = _get_string(report.get("note"))
    if note:
        lines.append(f"메모: {note}")

    lat = _get_number(report.get("lat"))
    lng = _get_number(report.get("lng"))
    if lat is not None and lng is not None:
        lines.append(f"좌표: {lat:.5f}, {lng:.5f}")
    else:
        lines.append("좌표: 없음 (승인 비활성화)")

    if stale_reason:
        lines.extend(["", stale_reason])
    else:
        lines.extend(_resolution_lines(outcome_label=outcome_label, actor=actor, metadata=metadata))

    return "\n".join(lines)


def _build_message_payload(
    entity_kind: ReviewEntityKind,
    source: dict[str, Any],
    *,
    disabled: bool,
    outcome_label: str | None = None,
    actor: DiscordActor | None = None,
    metadata: dict[str, Any] | None = None,
    stale_reason: str | None = None,
) -> dict[str, Any]:
    if entity_kind == "ai_review":
        content = _format_ai_review_content(
            source,
            outcome_label=outcome_label,
            actor=actor,
            metadata=metadata,
            stale_reason=stale_reason,
        )
    elif entity_kind == "ai_alias":
        content = _format_ai_alias_content(
            source,
            outcome_label=outcome_label,
            actor=actor,
            metadata=metadata,
            stale_reason=stale_reason,
        )
    else:
        content = _format_report_content(
            source,
            outcome_label=outcome_label,
            actor=actor,
            metadata=metadata,
            stale_reason=stale_reason,
        )

    approve_disabled = entity_kind == "report" and (
        _get_number(source.get("lat")) is None or _get_number(source.get("lng")) is None
    )
    return {
        "content": content,
        "components": _build_components(
            entity_kind,
            str(source.get("id")),
            disabled=disabled,
            approve_disabled=approve_disabled,
        ),
    }


def _fetch_review_message(entity_kind: ReviewEntityKind, entity_id: str) -> dict[str, Any] | None:
    try:
        rows = (
            get_client()
            .table("discord_review_messages")
            .select("*")
            .eq("entity_kind", entity_kind)
            .eq("entity_id", entity_id)
            .eq("channel_id", settings.DISCORD_REVIEW_CHANNEL_ID.strip())
            .limit(1)
            .execute()
            .data
            or []
        )
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("discord_review_messages lookup unavailable: %s", exc)
        return None


def _upsert_review_message(
    *,
    entity_kind: ReviewEntityKind,
    entity_id: str,
    channel_id: str,
    message_id: str | None,
    state: ReviewMessageState,
    last_error: str | None = None,
    posted_at: str | None = None,
    resolved_at: str | None = None,
) -> None:
    try:
        now = _now_iso()
        payload = {
            "entity_kind": entity_kind,
            "entity_id": entity_id,
            "channel_id": channel_id,
            "message_id": message_id,
            "state": state,
            "posted_at": posted_at or now,
            "updated_at": now,
            "resolved_at": resolved_at,
            "last_error": last_error,
        }
        get_client().table("discord_review_messages").upsert(
            payload,
            on_conflict="entity_kind,entity_id,channel_id",
        ).execute()
    except Exception:
        logger.exception("Failed to upsert discord review message: %s/%s", entity_kind, entity_id)


def _log_review_action(
    *,
    entity_kind: ReviewEntityKind,
    entity_id: str,
    action: str,
    outcome: ReviewOutcome,
    actor: DiscordActor,
    payload: dict[str, Any],
) -> None:
    try:
        get_client().table("discord_review_action_logs").insert(
            {
                "entity_kind": entity_kind,
                "entity_id": entity_id,
                "action": action,
                "outcome": outcome,
                "discord_user_id": actor.discord_user_id,
                "discord_username": actor.discord_username,
                "channel_id": actor.channel_id,
                "message_id": actor.message_id,
                "payload": payload,
            }
        ).execute()
    except Exception:
        logger.exception("Failed to insert discord review action log: %s/%s", entity_kind, entity_id)


def _fetch_queue_row(row_id: str) -> dict[str, Any] | None:
    rows = (
        get_client()
        .table("ai_review_queue")
        .select("*")
        .eq("id", row_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _fetch_pending_queue_rows() -> list[dict[str, Any]]:
    return (
        get_client()
        .table("ai_review_queue")
        .select("*")
        .eq("status", "pending")
        .order("created_at")
        .execute()
        .data
        or []
    )


def _fetch_report_row(report_id: str) -> dict[str, Any] | None:
    rows = (
        get_client()
        .table("reports")
        .select("*, trends(name)")
        .eq("id", report_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _fetch_pending_reports() -> list[dict[str, Any]]:
    return (
        get_client()
        .table("reports")
        .select("*, trends(name)")
        .eq("status", "pending")
        .order("created_at")
        .execute()
        .data
        or []
    )


def _update_queue_status(row_id: str, status: QueueStatus) -> None:
    now = _now_iso()
    get_client().table("ai_review_queue").update(
        {
            "status": status,
            "resolved_at": None if status == "pending" else now,
            "updated_at": now,
        }
    ).eq("id", row_id).execute()


def _save_alias_decision(
    term_a: str,
    term_b: str,
    decision: AliasDecision,
    confidence: float | None,
    *,
    source_job: str = "admin",
) -> None:
    cleaned_a = clean_display_keyword(term_a)
    cleaned_b = clean_display_keyword(term_b)
    normalized_a = normalize_keyword_text(cleaned_a)
    normalized_b = normalize_keyword_text(cleaned_b)

    if not normalized_a or not normalized_b or normalized_a == normalized_b:
        raise ValueError("정규화 가능한 서로 다른 키워드를 입력해 주세요.")

    client = get_client()
    client.table("keyword_aliases").delete().eq("alias_normalized", normalized_a).eq(
        "canonical_normalized",
        normalized_b,
    ).execute()
    client.table("keyword_aliases").delete().eq("alias_normalized", normalized_b).eq(
        "canonical_normalized",
        normalized_a,
    ).execute()

    now = _now_iso()

    if decision == "separate":
        client.table("keyword_aliases").insert(
            {
                "alias": cleaned_a,
                "alias_normalized": normalized_a,
                "canonical_keyword": cleaned_b,
                "canonical_normalized": normalized_b,
                "decision_type": "separate",
                "confidence": confidence,
                "source_job": source_job,
                "last_seen_at": now,
            }
        ).execute()
        return

    alias, canonical = (
        (cleaned_a, cleaned_b) if decision == "merge" else (cleaned_b, cleaned_a)
    )
    alias_normalized = normalize_keyword_text(alias)
    canonical_normalized = normalize_keyword_text(canonical)

    client.table("keyword_aliases").delete().eq("alias_normalized", alias_normalized).neq(
        "canonical_normalized",
        canonical_normalized,
    ).execute()

    client.table("keyword_aliases").upsert(
        {
            "alias": alias,
            "alias_normalized": alias_normalized,
            "canonical_keyword": canonical,
            "canonical_normalized": canonical_normalized,
            "decision_type": "merge",
            "confidence": confidence,
            "source_job": source_job,
            "last_seen_at": now,
        },
        on_conflict="alias_normalized,canonical_normalized",
    ).execute()


def _apply_keyword(row: dict[str, Any]) -> None:
    keyword_name = clean_display_keyword(row.get("candidate_name"))
    existing_rows = (
        get_client()
        .table("keywords")
        .select("source")
        .eq("keyword", keyword_name)
        .limit(1)
        .execute()
        .data
        or []
    )
    existing_source = existing_rows[0].get("source") if existing_rows else None

    get_client().table("keywords").upsert(
        {
            "keyword": keyword_name,
            "category": _resolve_keyword_category(row),
            "is_active": True,
            "source": "manual" if existing_source == "manual" else "discovered",
            "baseline_volume": 0,
        },
        on_conflict="keyword",
    ).execute()


def _apply_trend(row: dict[str, Any]) -> None:
    payload = _queue_payload(row)
    now = _now_iso()
    trend_name = clean_display_keyword(row.get("candidate_name"))
    existing_rows = []
    trend_id = _get_string(row.get("trend_id"))

    if not trend_id:
        existing_rows = (
            get_client()
            .table("trends")
            .select("id, status")
            .eq("name", trend_name)
            .limit(1)
            .execute()
            .data
            or []
        )

    existing_named_trend = existing_rows[0] if existing_rows else None
    existing_status = _get_string(payload.get("existing_status")) or _get_string(
        existing_named_trend.get("status") if existing_named_trend else None
    )
    trend_data = {
        "name": trend_name,
        "category": _resolve_keyword_category(row),
        "status": _resolve_trend_status(existing_status),
        "detected_at": now,
        "peak_score": _get_number(payload.get("score")) or 0,
        "score_breakdown": _score_breakdown(payload.get("score_breakdown")),
        "ai_verdict": row.get("ai_verdict"),
        "ai_reason": row.get("reason"),
        "ai_confidence": row.get("confidence"),
        "ai_reviewed_at": now,
        "ai_model": row.get("model"),
        "ai_grounding_sources": _get_string_array(payload.get("grounding_sources")),
        "ai_consecutive_accepts": 0,
        "ai_consecutive_rejects": 0,
    }

    client = get_client()
    if trend_id and (not existing_named_trend or existing_named_trend.get("id") == trend_id):
        client.table("trends").update(trend_data).eq("id", trend_id).execute()
        return

    if existing_named_trend and existing_named_trend.get("id"):
        client.table("trends").update(trend_data).eq("id", existing_named_trend["id"]).execute()
        return

    client.table("trends").insert(trend_data).execute()


def _approve_ai_review(row: dict[str, Any]) -> dict[str, Any]:
    if row.get("item_type") == "keyword":
        _apply_keyword(row)
        applied_label = f"{clean_display_keyword(row.get('candidate_name'))} 키워드를 반영했습니다."
    else:
        _apply_trend(row)
        applied_label = f"{clean_display_keyword(row.get('candidate_name'))} 트렌드를 반영했습니다."

    _update_queue_status(str(row.get("id")), "applied")
    return {
        "outcome_label": "승인",
        "notice": applied_label,
        "resolved_at": _now_iso(),
    }


def _reject_ai_review(row: dict[str, Any]) -> dict[str, Any]:
    _update_queue_status(str(row.get("id")), "rejected")
    return {
        "outcome_label": "거절",
        "notice": f"{clean_display_keyword(row.get('candidate_name'))} 항목을 거절했습니다.",
        "resolved_at": _now_iso(),
    }


def _resolve_ai_alias(row: dict[str, Any], decision: AliasDecision) -> dict[str, Any]:
    payload = _queue_payload(row)
    candidate_name = clean_display_keyword(row.get("candidate_name"))
    suggested_canonical = clean_display_keyword(payload.get("canonical_keyword"))

    if not candidate_name or not suggested_canonical:
        raise ValueError("대표명 제안을 읽을 수 없는 항목입니다.")

    _save_alias_decision(
        candidate_name,
        suggested_canonical,
        decision,
        _get_number(row.get("confidence")),
        source_job="admin",
    )

    if decision == "separate":
        _update_queue_status(str(row.get("id")), "rejected")
        return {
            "outcome_label": "다른 상품 유지",
            "notice": f"{candidate_name}과 {suggested_canonical}을(를) 다른 상품으로 유지했습니다.",
            "resolved_at": _now_iso(),
        }

    _update_queue_status(str(row.get("id")), "approved")
    if decision == "merge":
        notice = f"{candidate_name}을(를) {suggested_canonical} 대표명으로 묶었습니다."
        outcome_label = "묶기"
    else:
        notice = f"{suggested_canonical} -> {candidate_name} 방향으로 대표명을 뒤집었습니다."
        outcome_label = "뒤집기"

    return {
        "outcome_label": outcome_label,
        "notice": notice,
        "resolved_at": _now_iso(),
    }


def _approve_report(report: dict[str, Any]) -> dict[str, Any]:
    lat = _get_number(report.get("lat"))
    lng = _get_number(report.get("lng"))
    if lat is None or lng is None:
        raise ValueError("좌표가 없는 제보는 승인할 수 없습니다.")

    client = get_client()
    client.table("reports").update({"status": "verified"}).eq("id", report["id"]).execute()
    client.table("stores").insert(
        {
            "trend_id": report.get("trend_id"),
            "name": report.get("store_name"),
            "address": report.get("address"),
            "lat": lat,
            "lng": lng,
            "phone": None,
            "place_url": None,
            "rating": None,
            "source": "user_report",
            "verified": True,
        }
    ).execute()

    return {
        "outcome_label": "승인",
        "notice": f"{clean_display_keyword(report.get('store_name'))} 제보를 승인했습니다.",
        "resolved_at": _now_iso(),
    }


def _reject_report(report: dict[str, Any]) -> dict[str, Any]:
    get_client().table("reports").delete().eq("id", report["id"]).execute()
    return {
        "outcome_label": "거절",
        "notice": f"{clean_display_keyword(report.get('store_name'))} 제보를 거절했습니다.",
        "resolved_at": _now_iso(),
    }


async def _deliver_message(
    *,
    entity_kind: ReviewEntityKind,
    source: dict[str, Any],
    state: ReviewMessageState,
    outcome_label: str | None = None,
    actor: DiscordActor | None = None,
    metadata: dict[str, Any] | None = None,
    stale_reason: str | None = None,
) -> dict[str, Any]:
    if not is_discord_review_enabled():
        return {"changed": False, "reason": "disabled"}

    entity_id = str(source.get("id"))
    channel_id = settings.DISCORD_REVIEW_CHANNEL_ID.strip()
    payload = _build_message_payload(
        entity_kind,
        source,
        disabled=state != "active",
        outcome_label=outcome_label,
        actor=actor,
        metadata=metadata or {},
        stale_reason=stale_reason,
    )

    record = _fetch_review_message(entity_kind, entity_id)
    message_id = _get_string(record.get("message_id")) if record else None
    posted_at = _get_string(record.get("posted_at")) if record else None

    try:
        if message_id:
            await edit_channel_message(channel_id, message_id, payload)
        else:
            created = await create_channel_message(channel_id, payload)
            message_id = _get_string(created.get("id"))
            posted_at = _now_iso()

        _upsert_review_message(
            entity_kind=entity_kind,
            entity_id=entity_id,
            channel_id=channel_id,
            message_id=message_id,
            state=state,
            last_error=None,
            posted_at=posted_at,
            resolved_at=metadata.get("resolved_at") if metadata else None,
        )
        return {"changed": True, "message_id": message_id}
    except DiscordBotNotFoundError:
        created = await create_channel_message(channel_id, payload)
        message_id = _get_string(created.get("id"))
        _upsert_review_message(
            entity_kind=entity_kind,
            entity_id=entity_id,
            channel_id=channel_id,
            message_id=message_id,
            state=state,
            last_error=None,
            posted_at=_now_iso(),
            resolved_at=metadata.get("resolved_at") if metadata else None,
        )
        return {"changed": True, "message_id": message_id}
    except DiscordBotError as exc:
        logger.warning("Discord review message sync failed for %s/%s: %s", entity_kind, entity_id, exc)
        _upsert_review_message(
            entity_kind=entity_kind,
            entity_id=entity_id,
            channel_id=channel_id,
            message_id=message_id,
            state="failed",
            last_error=str(exc),
            posted_at=posted_at,
            resolved_at=metadata.get("resolved_at") if metadata else None,
        )
        return {"changed": False, "reason": str(exc)}


async def _stale_other_ai_variant_messages(row: dict[str, Any], keep_kind: ReviewEntityKind) -> None:
    entity_id = str(row.get("id"))
    channel_id = settings.DISCORD_REVIEW_CHANNEL_ID.strip()
    for entity_kind in AI_REVIEW_ENTITY_KINDS:
        if entity_kind == keep_kind:
            continue

        record = _fetch_review_message(entity_kind, entity_id)
        if not record or record.get("state") != "active":
            continue

        await _deliver_message(
            entity_kind=entity_kind,
            source=row,
            state="stale",
            stale_reason="이 항목은 분류가 변경되어 다른 메시지에서 처리됩니다.",
            metadata={"resolved_at": _now_iso()},
        )
        _upsert_review_message(
            entity_kind=entity_kind,
            entity_id=entity_id,
            channel_id=channel_id,
            message_id=_get_string(record.get("message_id")),
            state="stale",
            last_error=None,
            posted_at=_get_string(record.get("posted_at")),
            resolved_at=_now_iso(),
        )


async def ensure_ai_review_message(row: dict[str, Any]) -> dict[str, Any]:
    if not is_discord_review_enabled():
        return {"changed": False, "reason": "disabled"}

    entity_kind = _resolve_queue_entity_kind(row)
    await _stale_other_ai_variant_messages(row, entity_kind)
    return await _deliver_message(
        entity_kind=entity_kind,
        source=row,
        state="active",
    )


async def ensure_report_review_message(report: dict[str, Any]) -> dict[str, Any]:
    if not is_discord_review_enabled():
        return {"changed": False, "reason": "disabled"}

    return await _deliver_message(
        entity_kind="report",
        source=report,
        state="active",
    )


def _resolve_actor(interaction: dict[str, Any]) -> DiscordActor:
    member = _get_record(interaction.get("member"))
    user = _get_record(member.get("user")) or _get_record(interaction.get("user"))
    username = (
        _get_string(member.get("nick"))
        or _get_string(user.get("global_name"))
        or _get_string(user.get("username"))
        or "unknown"
    )
    return DiscordActor(
        discord_user_id=_get_string(user.get("id")) or "unknown",
        discord_username=username,
        channel_id=_get_string(interaction.get("channel_id")) or "",
        message_id=_get_string(_get_record(interaction.get("message")).get("id")),
    )


async def process_interaction(interaction: dict[str, Any]) -> ActionExecutionResult:
    actor = _resolve_actor(interaction)
    custom_id = _get_string(_get_record(interaction.get("data")).get("custom_id"))
    parsed = parse_custom_id(custom_id)
    if not parsed:
        return ActionExecutionResult(
            entity_kind="report",
            entity_id="unknown",
            action="unknown",
            outcome="error",
            message="알 수 없는 디스코드 액션입니다.",
            metadata={"reason": "invalid_custom_id"},
        )

    entity_kind, action, entity_id = parsed

    if actor.channel_id != settings.DISCORD_REVIEW_CHANNEL_ID.strip():
        _log_review_action(
            entity_kind=entity_kind,
            entity_id=entity_id,
            action=action,
            outcome="noop",
            actor=actor,
            payload={"reason": "channel_not_allowed"},
        )
        return ActionExecutionResult(
            entity_kind=entity_kind,
            entity_id=entity_id,
            action=action,
            outcome="noop",
            message="이 채널에서는 사용할 수 없는 액션입니다.",
            metadata={"reason": "channel_not_allowed"},
        )

    try:
        if entity_kind == "ai_review":
            row = _fetch_queue_row(entity_id)
            if not row:
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="noop",
                    message="이미 처리되었거나 존재하지 않는 AI 보류 항목입니다.",
                    metadata={"reason": "missing"},
                )
            elif row.get("status") != "pending":
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=row,
                    state="resolved",
                    outcome_label="이미 처리됨",
                    actor=actor,
                    metadata={"resolved_at": _get_string(row.get("resolved_at")) or _now_iso()},
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="noop",
                    message="이미 처리된 AI 보류 항목입니다.",
                    metadata={"reason": "already_resolved", "status": row.get("status")},
                )
            elif action == "approve":
                metadata = _approve_ai_review(row)
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=_fetch_queue_row(entity_id) or row,
                    state="resolved",
                    outcome_label=metadata["outcome_label"],
                    actor=actor,
                    metadata=metadata,
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="success",
                    message=metadata["notice"],
                    metadata=metadata,
                )
            elif action == "reject":
                metadata = _reject_ai_review(row)
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=_fetch_queue_row(entity_id) or row,
                    state="resolved",
                    outcome_label=metadata["outcome_label"],
                    actor=actor,
                    metadata=metadata,
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="success",
                    message=metadata["notice"],
                    metadata=metadata,
                )
            else:
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="error",
                    message="지원하지 않는 AI 보류 액션입니다.",
                    metadata={"reason": "unsupported_action"},
                )
        elif entity_kind == "ai_alias":
            row = _fetch_queue_row(entity_id)
            if not row:
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="noop",
                    message="이미 처리되었거나 존재하지 않는 AI 동의어 항목입니다.",
                    metadata={"reason": "missing"},
                )
            elif row.get("status") != "pending":
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=row,
                    state="resolved",
                    outcome_label="이미 처리됨",
                    actor=actor,
                    metadata={"resolved_at": _get_string(row.get("resolved_at")) or _now_iso()},
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="noop",
                    message="이미 처리된 AI 동의어 항목입니다.",
                    metadata={"reason": "already_resolved", "status": row.get("status")},
                )
            elif action in {"merge", "separate", "reverse"}:
                metadata = _resolve_ai_alias(row, action)
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=_fetch_queue_row(entity_id) or row,
                    state="resolved",
                    outcome_label=metadata["outcome_label"],
                    actor=actor,
                    metadata=metadata,
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="success",
                    message=metadata["notice"],
                    metadata=metadata,
                )
            else:
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="error",
                    message="지원하지 않는 AI 동의어 액션입니다.",
                    metadata={"reason": "unsupported_action"},
                )
        else:
            report = _fetch_report_row(entity_id)
            if not report:
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="noop",
                    message="이미 처리되었거나 존재하지 않는 제보입니다.",
                    metadata={"reason": "missing"},
                )
            elif report.get("status") != "pending":
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=report,
                    state="resolved",
                    outcome_label="이미 처리됨",
                    actor=actor,
                    metadata={"resolved_at": _now_iso()},
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="noop",
                    message="이미 처리된 제보입니다.",
                    metadata={"reason": "already_resolved", "status": report.get("status")},
                )
            elif action == "approve":
                metadata = _approve_report(report)
                updated_report = _fetch_report_row(entity_id) or report
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=updated_report,
                    state="resolved",
                    outcome_label=metadata["outcome_label"],
                    actor=actor,
                    metadata=metadata,
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="success",
                    message=metadata["notice"],
                    metadata=metadata,
                )
            elif action == "reject":
                metadata = _reject_report(report)
                await _deliver_message(
                    entity_kind=entity_kind,
                    source=report,
                    state="resolved",
                    outcome_label=metadata["outcome_label"],
                    actor=actor,
                    metadata=metadata,
                )
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="success",
                    message=metadata["notice"],
                    metadata=metadata,
                )
            else:
                result = ActionExecutionResult(
                    entity_kind=entity_kind,
                    entity_id=entity_id,
                    action=action,
                    outcome="error",
                    message="지원하지 않는 제보 액션입니다.",
                    metadata={"reason": "unsupported_action"},
                )
    except Exception as exc:
        logger.exception("Discord review action failed: %s/%s %s", entity_kind, entity_id, action)
        result = ActionExecutionResult(
            entity_kind=entity_kind,
            entity_id=entity_id,
            action=action,
            outcome="error",
            message=str(exc) or "처리 중 오류가 발생했습니다.",
            metadata={"reason": "exception", "error": str(exc)},
        )

    _log_review_action(
        entity_kind=result.entity_kind,
        entity_id=result.entity_id,
        action=result.action,
        outcome=result.outcome,
        actor=actor,
        payload=result.metadata,
    )
    return result


async def sync_pending_review_messages() -> dict[str, int]:
    if not is_discord_review_enabled():
        return {"ai_review": 0, "ai_alias": 0, "report": 0}

    counts = {"ai_review": 0, "ai_alias": 0, "report": 0}

    for row in _fetch_pending_queue_rows():
        entity_kind = _resolve_queue_entity_kind(row)
        result = await ensure_ai_review_message(row)
        if result.get("changed"):
            counts[entity_kind] += 1

    for report in _fetch_pending_reports():
        result = await ensure_report_review_message(report)
        if result.get("changed"):
            counts["report"] += 1

    return counts


def _schedule_background_task(coro: Any, description: str) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("No running loop; skipped background task: %s", description)
        return

    task = loop.create_task(coro)

    def _done_callback(done_task: asyncio.Task) -> None:
        try:
            done_task.result()
        except Exception:
            logger.exception("Background Discord review task failed: %s", description)

    task.add_done_callback(_done_callback)


def schedule_ai_review_message_sync(row: dict[str, Any] | None) -> None:
    if not row or not is_discord_review_enabled():
        return
    _schedule_background_task(
        ensure_ai_review_message(row),
        f"ai_review_message_sync:{row.get('id')}",
    )
