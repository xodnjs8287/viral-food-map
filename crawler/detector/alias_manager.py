from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable

DISPLAY_WHITESPACE_RE = re.compile(r"\s+")
NORMALIZE_RE = re.compile(r"[^0-9A-Za-z\uAC00-\uD7A3]+")


def clean_display_keyword(value: str | None) -> str:
    return DISPLAY_WHITESPACE_RE.sub(" ", str(value or "")).strip()


def normalize_keyword_text(value: str | None) -> str:
    cleaned = clean_display_keyword(value).lower()
    return NORMALIZE_RE.sub("", cleaned)


def build_alias_lookup(alias_rows: list[dict]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for row in alias_rows:
        alias_key = row.get("alias_normalized") or normalize_keyword_text(
            row.get("alias")
        )
        canonical_keyword = clean_display_keyword(row.get("canonical_keyword"))
        if alias_key and canonical_keyword:
            lookup[alias_key] = canonical_keyword
    return lookup


def build_alias_terms_by_canonical(alias_rows: list[dict]) -> dict[str, list[str]]:
    terms_by_canonical: dict[str, list[str]] = defaultdict(list)
    for row in alias_rows:
        canonical_keyword = clean_display_keyword(row.get("canonical_keyword"))
        alias = clean_display_keyword(row.get("alias"))
        if not canonical_keyword or not alias:
            continue
        terms_by_canonical[canonical_keyword].append(alias)

    deduped: dict[str, list[str]] = {}
    for canonical_keyword, terms in terms_by_canonical.items():
        deduped[canonical_keyword] = dedupe_terms([canonical_keyword, *terms])
    return deduped


def resolve_keyword_alias(
    keyword: str,
    alias_lookup: dict[str, str],
) -> tuple[str, bool]:
    cleaned = clean_display_keyword(keyword)
    canonical_keyword = alias_lookup.get(normalize_keyword_text(cleaned))
    if not canonical_keyword:
        return cleaned, False
    return canonical_keyword, canonical_keyword != cleaned


def dedupe_terms(terms: Iterable[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for term in terms:
        cleaned = clean_display_keyword(term)
        key = normalize_keyword_text(cleaned)
        if not cleaned or not key or key in seen:
            continue
        seen.add(key)
        deduped.append(cleaned)
    return deduped


def build_alias_rows(
    canonical_keyword: str,
    aliases: Iterable[str],
    *,
    confidence: float | None,
    source_job: str,
) -> list[dict]:
    rows: list[dict] = []
    cleaned_canonical = clean_display_keyword(canonical_keyword)
    canonical_key = normalize_keyword_text(cleaned_canonical)
    if not cleaned_canonical or not canonical_key:
        return rows

    for alias in dedupe_terms(aliases):
        alias_key = normalize_keyword_text(alias)
        if not alias_key or alias_key == canonical_key:
            continue
        rows.append(
            {
                "alias": alias,
                "alias_normalized": alias_key,
                "canonical_keyword": cleaned_canonical,
                "canonical_normalized": canonical_key,
                "confidence": confidence,
                "source_job": source_job,
            }
        )

    return rows


def get_canonicalization_label(source: str, target: str) -> str | None:
    source_keyword = clean_display_keyword(source)
    target_keyword = clean_display_keyword(target)
    if not source_keyword or not target_keyword or source_keyword == target_keyword:
        return None
    return f"{source_keyword} -> {target_keyword}"
