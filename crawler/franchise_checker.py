"""프랜차이즈 브랜드 판별 모듈.

공정거래위원회 가맹사업 정보공개서 기반 브랜드 리스트를 사용하여
매장명이 프랜차이즈인지 판별합니다.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_BRANDS: set[str] | None = None
_SORTED_BRANDS: list[str] | None = None
_COMPACT_BRANDS: set[str] | None = None

DATA_PATH = Path(__file__).parent / "data" / "franchise_brands.json"
_BRANCH_SUFFIX_RE = re.compile(
    r"^[가-힣A-Za-z0-9]+(점|호점|역점|본점|직영점|DT|R)$",
)


def _load_brands() -> set[str]:
    global _BRANDS
    if _BRANDS is not None:
        return _BRANDS

    try:
        with open(DATA_PATH, encoding="utf-8") as f:
            brand_list: list[str] = json.load(f)
        _BRANDS = set(brand_list)
        logger.info(f"프랜차이즈 브랜드 {len(_BRANDS)}개 로드 완료")
    except FileNotFoundError:
        logger.warning(f"프랜차이즈 브랜드 파일 없음: {DATA_PATH}")
        _BRANDS = set()

    return _BRANDS


def _normalize_spaces(text: str) -> str:
    return re.sub(r"[\s\u00a0]+", " ", text).strip()


def _compact(text: str) -> str:
    return re.sub(r"[\s\u00a0]+", "", text).strip()


def _get_sorted_brands() -> list[str]:
    global _SORTED_BRANDS
    if _SORTED_BRANDS is not None:
        return _SORTED_BRANDS

    _SORTED_BRANDS = sorted(_load_brands(), key=len, reverse=True)
    return _SORTED_BRANDS


def _get_compact_brands() -> set[str]:
    global _COMPACT_BRANDS
    if _COMPACT_BRANDS is not None:
        return _COMPACT_BRANDS

    _COMPACT_BRANDS = {_compact(brand) for brand in _load_brands()}
    return _COMPACT_BRANDS


def is_franchise(store_name: str) -> bool:
    """매장명이 프랜차이즈 브랜드에 해당하는지 판별.

    매장명에서 지점명(XX점, XX역점 등)을 제거한 뒤
    브랜드 리스트와 매칭합니다.
    """
    brands = _load_brands()
    if not brands:
        return False

    name = _normalize_spaces(store_name)
    compact_name = _compact(name)

    # 1) 정확히 일치
    if name in brands or compact_name in _get_compact_brands():
        return True

    # 2) 매장명이 "브랜드명 + 지점명" 패턴인지 확인
    #    e.g. "스타벅스 강남역점", "BBQ 서초점", "이디야커피 홍대점"
    for brand in _get_sorted_brands():
        if len(brand) < 2:
            continue

        compact_brand = _compact(brand)
        if not compact_name.startswith(compact_brand):
            continue

        if compact_name == compact_brand:
            return True

        remainder_compact = compact_name[len(compact_brand) :]

        # 공백이 있거나(기존 케이스), 공백이 없어도 지점 접미사 패턴이면 프랜차이즈로 판단
        if name.startswith(brand) and len(name) > len(brand) and name[len(brand)] in {" ", "\u00a0"}:
            return True
        if _BRANCH_SUFFIX_RE.match(remainder_compact):
            return True

    return False


def check_franchise_batch(store_names: list[str]) -> dict[str, bool]:
    """여러 매장명을 한 번에 판별."""
    return {name: is_franchise(name) for name in store_names}
