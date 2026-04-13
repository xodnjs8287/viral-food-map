from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha1
import re
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from crawlers.new_product_sources import SOURCE_DEFINITIONS, NewProductSourceDefinition

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
    )
}
SEARCH_RESULT_LIMIT = 6
SEARCH_ROOT_QUERY_KEYWORDS = {
    "franchise": ("공식", "홈페이지", "브랜드"),
    "convenience": ("공식", "홈페이지"),
}
DISCOVERY_QUERY_KEYWORDS = {
    "franchise": ("신메뉴", "신제품", "메뉴", "프로모션", "이벤트"),
    "convenience": ("신상품", "신상", "도시락", "삼각김밥", "샌드위치"),
}
BRAND_ALIAS_SOURCE_KEYS = {
    "롯데리아": "lotteeatz_launch_events",
    "엔제리너스": "lotteeatz_launch_events",
    "크리스피크림": "lotteeatz_launch_events",
    "메가커피": "mega_seasonal_menu",
    "메가엠지씨커피": "mega_seasonal_menu",
    "빽다방커피": "paikdabang_news",
    "컴포즈": "composecoffee_event",
    "버거킹코리아": "burgerking_event_feed",
    "공차코리아": "gongcha_event_list",
    "푸라닭": "puradak_event_list",
    "푸라닭치킨": "puradak_event_list",
}
RESULT_HOST_BLOCKLIST = {
    "blog.naver.com",
    "cafe.naver.com",
    "m.blog.naver.com",
    "post.naver.com",
    "section.blog.naver.com",
    "www.instagram.com",
    "instagram.com",
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "x.com",
    "twitter.com",
    "www.facebook.com",
    "facebook.com",
    "m.facebook.com",
}
INTERNAL_LINK_HINTS = (
    "new",
    "menu",
    "promotion",
    "event",
    "launch",
    "news",
    "신메뉴",
    "신제품",
    "메뉴",
    "프로모션",
    "이벤트",
    "출시",
    "소식",
)


@dataclass(slots=True)
class DiscoveredNewProductSource:
    source: NewProductSourceDefinition
    matched_url: str
    official_site_url: str
    confidence: float
    search_queries: list[str]
    notes: list[str]


def _apply_manual_sector(
    source: NewProductSourceDefinition,
    sector_key: str | None,
) -> NewProductSourceDefinition:
    if not sector_key:
        return source

    source.discovery_metadata = deepcopy(source.discovery_metadata)
    source.discovery_metadata["sector_key"] = sector_key
    return source


def _normalize_brand_key(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", value.lower())


def _normalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme}://{parsed.netloc.lower()}{path}"


def _get_root_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc.lower()}"


def _get_host(url: str) -> str:
    return urlparse(url).netloc.lower()


def _clone_source(source: NewProductSourceDefinition) -> NewProductSourceDefinition:
    return NewProductSourceDefinition(
        source_key=source.source_key,
        title=source.title,
        brand=source.brand,
        source_type=source.source_type,
        channel=source.channel,
        site_url=source.site_url,
        crawl_url=source.crawl_url,
        parser_type=source.parser_type,
        parser_config=deepcopy(source.parser_config),
        source_origin=source.source_origin,
        discovery_metadata=deepcopy(source.discovery_metadata),
    )


def _build_admin_source_definition(
    *,
    brand: str,
    source_type: str,
    channel: str,
    site_url: str,
    crawl_url: str,
    parser_type: str,
    parser_config: dict[str, Any],
    title: str | None = None,
    discovery_metadata: dict[str, Any] | None = None,
) -> NewProductSourceDefinition:
    host = _get_host(crawl_url).replace(".", "-")
    brand_slug = _normalize_brand_key(brand) or host
    source_hash = sha1(f"{crawl_url}|{parser_type}".encode("utf-8")).hexdigest()[:8]
    source_key = f"admin-{brand_slug}-{host}-{source_hash}"
    return NewProductSourceDefinition(
        source_key=source_key[:120],
        title=title or f"{brand} 공식 {channel}",
        brand=brand,
        source_type=source_type,
        channel=channel,
        site_url=site_url,
        crawl_url=crawl_url,
        parser_type=parser_type,
        parser_config=deepcopy(parser_config),
        source_origin="admin",
        discovery_metadata=deepcopy(discovery_metadata or {}),
    )


def _decode_duckduckgo_result_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None

    if raw_url.startswith("//duckduckgo.com/l/?"):
        raw_url = f"https:{raw_url}"

    parsed = urlparse(raw_url)
    if "duckduckgo.com" in parsed.netloc and parsed.path == "/l/":
        target = parse_qs(parsed.query).get("uddg", [None])[0]
        return unquote(target) if target else None

    return raw_url


def _is_supported_result_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False

    host = parsed.netloc.lower()
    if not host or host in RESULT_HOST_BLOCKLIST:
        return False

    return True


def _extract_search_result_urls(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    urls: list[str] = []
    seen: set[str] = set()

    for link in soup.select(".result__a, a.result__a"):
        decoded = _decode_duckduckgo_result_url(link.get("href"))
        if not decoded or not _is_supported_result_url(decoded):
            continue
        normalized = _normalize_url(decoded)
        if normalized in seen:
            continue
        seen.add(normalized)
        urls.append(decoded)

    return urls


async def _search_candidate_urls(
    client: httpx.AsyncClient,
    *,
    brand: str,
    source_type: str,
) -> tuple[list[str], list[str]]:
    queries: list[str] = []
    urls: list[str] = []
    seen: set[str] = set()

    query_keywords = (
        *DISCOVERY_QUERY_KEYWORDS[source_type],
        *SEARCH_ROOT_QUERY_KEYWORDS[source_type],
    )
    for keyword in query_keywords:
        query = f"{brand} {keyword}"
        queries.append(query)
        response = await client.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers=REQUEST_HEADERS,
        )
        response.raise_for_status()

        for url in _extract_search_result_urls(response.text)[:SEARCH_RESULT_LIMIT]:
            for candidate in (url, _get_root_url(url)):
                normalized = _normalize_url(candidate)
                if normalized in seen:
                    continue
                seen.add(normalized)
                urls.append(candidate)

    return queries, urls


def _collect_internal_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    base_host = _get_host(base_url)
    links: list[str] = []
    seen: set[str] = set()

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "").strip()
        absolute_url = urljoin(base_url, href)
        if _get_host(absolute_url) != base_host:
            continue

        text = f"{anchor.get_text(' ', strip=True)} {href}".lower()
        if not any(hint in text for hint in INTERNAL_LINK_HINTS):
            continue

        normalized = _normalize_url(absolute_url)
        if normalized in seen:
            continue
        seen.add(normalized)
        links.append(absolute_url)

    return links[:12]


def _looks_like_builtin_brand(brand: str, source_type: str) -> NewProductSourceDefinition | None:
    alias_source_key = BRAND_ALIAS_SOURCE_KEYS.get(brand.strip())
    if alias_source_key:
        aliased = next(
            (source for source in SOURCE_DEFINITIONS if source.source_key == alias_source_key),
            None,
        )
        if aliased and aliased.source_type == source_type:
            return _clone_source(aliased)

    brand_key = _normalize_brand_key(brand)
    for source in SOURCE_DEFINITIONS:
        if source.source_type != source_type:
            continue
        source_brand_key = _normalize_brand_key(source.brand)
        if not source_brand_key:
            continue
        if brand_key == source_brand_key or brand_key in source_brand_key or source_brand_key in brand_key:
            return _clone_source(source)
    return None


def _match_builtin_source_from_urls(
    candidate_url: str,
    *,
    source_type: str,
    internal_links: list[str] | None = None,
) -> tuple[NewProductSourceDefinition, str, list[str]] | None:
    candidate_host = _get_host(candidate_url)
    normalized_candidate = _normalize_url(candidate_url)
    related_urls = [candidate_url, *(internal_links or ())]

    for source in SOURCE_DEFINITIONS:
        if source.source_type != source_type:
            continue

        source_host = _get_host(source.crawl_url or source.site_url)
        if source_host != candidate_host:
            continue

        source_crawl_url = _normalize_url(source.crawl_url)
        source_site_url = _normalize_url(source.site_url)
        if normalized_candidate.startswith(source_crawl_url):
            return _clone_source(source), candidate_url, ["검색 결과가 공식 크롤 URL과 직접 일치했습니다."]
        if normalized_candidate.startswith(source_site_url):
            return _clone_source(source), candidate_url, ["검색 결과가 공식 사이트와 일치했습니다."]

        for related_url in related_urls:
            if _normalize_url(related_url).startswith(source_crawl_url):
                return _clone_source(source), related_url, ["공식 사이트 내부 링크에서 기존 parser preset을 찾았습니다."]

    return None


async def _fetch_soup(client: httpx.AsyncClient, url: str) -> BeautifulSoup:
    try:
        response = await client.get(url, headers=REQUEST_HEADERS, follow_redirects=True)
        response.raise_for_status()
        return BeautifulSoup(response.text, "html.parser")
    except httpx.HTTPError:
        async with httpx.AsyncClient(
            timeout=client.timeout,
            follow_redirects=True,
            verify=False,
        ) as insecure_client:
            insecure_response = await insecure_client.get(
                url,
                headers=REQUEST_HEADERS,
            )
        insecure_response.raise_for_status()
        return BeautifulSoup(insecure_response.text, "html.parser")


def _detect_generic_table_board_source(
    *,
    brand: str,
    source_type: str,
    candidate_url: str,
    soup: BeautifulSoup,
    notes: list[str],
) -> NewProductSourceDefinition | None:
    selectors = (".board_wrap table tbody tr", "table tbody tr")
    matched_selector = None
    first_valid_row = None

    for selector in selectors:
        rows = soup.select(selector)
        if not rows:
            continue
        for row in rows[:8]:
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            for title_idx in range(len(cells)):
                link = cells[title_idx].find("a", href=True)
                if not link:
                    continue
                date_candidates = [
                    _normalize_text(cell.get_text(" ", strip=True))
                    for cell in cells
                ]
                date_idx = next(
                    (
                        idx
                        for idx, cell_text in enumerate(date_candidates)
                        if re.search(r"(\d{2,4}[.-]\d{1,2}[.-]\d{1,2})", cell_text)
                    ),
                    None,
                )
                if date_idx is None:
                    continue
                matched_selector = selector
                first_valid_row = {
                    "cells": cells,
                    "title_idx": title_idx,
                    "date_idx": date_idx,
                }
                break
            if first_valid_row:
                break
        if first_valid_row:
            break

    if not first_valid_row or not matched_selector:
        return None

    cells = first_valid_row["cells"]
    title_idx = int(first_valid_row["title_idx"])
    date_idx = int(first_valid_row["date_idx"])
    title_text = _normalize_text(cells[title_idx].get_text(" ", strip=True))
    date_sample = _normalize_text(cells[date_idx].get_text(" ", strip=True))
    date_format = "short_dot" if re.search(r"\b\d{2}\.\d{2}\.\d{2}\b", date_sample) else (
        "dot" if "." in date_sample else "dash"
    )
    category_idx = 1 if len(cells) >= 4 and title_idx != 1 and date_idx != 1 else None
    notes.append("테이블형 공식 공지/뉴스 페이지를 탐지해 html_board_news_table parser를 적용했습니다.")

    parser_config: dict[str, Any] = {
        "row_selector": matched_selector,
        "min_cell_count": len(cells),
        "title_cell_index": title_idx,
        "date_cell_index": date_idx,
        "date_format": date_format,
        "detail_link_selector": "a[href]",
        "default_category": "신메뉴 소식",
        "summary_fallback": "{brand} 공식 소식",
        "detail_image_markers": ("/wp-content/uploads/", "/upload/", "/uploads/", "/files/"),
        "max_items": 40,
    }
    if category_idx is not None:
        parser_config["category_cell_index"] = category_idx

    return _build_admin_source_definition(
        brand=brand,
        source_type=source_type,
        channel="소식",
        site_url=candidate_url,
        crawl_url=candidate_url,
        parser_type="html_board_news_table",
        parser_config=parser_config,
        discovery_metadata={
            "detected_by": "html_board_news_table",
            "matched_url": candidate_url,
            "sample_title": title_text,
        },
    )


def _detect_generic_board_news_source(
    *,
    brand: str,
    source_type: str,
    candidate_url: str,
    soup: BeautifulSoup,
    notes: list[str],
) -> NewProductSourceDefinition | None:
    return _detect_generic_table_board_source(
        brand=brand,
        source_type=source_type,
        candidate_url=candidate_url,
        soup=soup,
        notes=notes,
    )


def _detect_generic_card_news_grid_source(
    *,
    brand: str,
    source_type: str,
    candidate_url: str,
    soup: BeautifulSoup,
    notes: list[str],
) -> NewProductSourceDefinition | None:
    items = soup.select(".board_list li")
    if len(items) < 3:
        return None

    valid_items = 0
    for item in items[:6]:
        title = item.select_one(".doc_title")
        date = item.select_one(".regdate")
        link = item.select_one("a.doc_link[href]")
        if title and date and link:
            valid_items += 1

    if valid_items < 3:
        return None

    notes.append("웹진형 공식 뉴스/이벤트 목록을 탐지해 html_card_news_grid parser를 적용했습니다.")
    return _build_admin_source_definition(
        brand=brand,
        source_type=source_type,
        channel="이벤트",
        site_url=candidate_url,
        crawl_url=candidate_url,
        parser_type="html_card_news_grid",
        parser_config={
            "item_selector": ".board_list li",
            "detail_link_selector": "a.doc_link[href]",
            "title_selector": ".doc_title",
            "date_selector": ".regdate",
            "date_format": "dash_datetime",
            "image_selector": ".image_area img",
            "default_category": "신메뉴 이벤트",
            "summary_fallback": "{brand} 공식 이벤트",
            "max_items": 40,
        },
        discovery_metadata={
            "detected_by": "html_card_news_grid",
            "matched_url": candidate_url,
        },
    )


def _detect_generic_event_card_list_source(
    *,
    brand: str,
    source_type: str,
    candidate_url: str,
    soup: BeautifulSoup,
    notes: list[str],
) -> NewProductSourceDefinition | None:
    items = soup.select(".event_list_wrapper li")
    if len(items) < 3:
        return None

    valid_items = 0
    for item in items[:6]:
        title = item.select_one(".title")
        date = item.select_one(".date")
        anchor = item.find("a")
        onclick = anchor.get("onclick", "") if anchor else ""
        if title and date and re.search(r"view\.view\((\d+)\)", onclick):
            valid_items += 1

    if valid_items < 2:
        return None

    notes.append("카드형 공식 이벤트 목록을 탐지해 html_event_card_list parser를 적용했습니다.")
    return _build_admin_source_definition(
        brand=brand,
        source_type=source_type,
        channel="이벤트",
        site_url=_get_root_url(candidate_url),
        crawl_url=candidate_url,
        parser_type="html_event_card_list",
        parser_config={
            "item_selector": ".event_list_wrapper li",
            "title_selector": ".title",
            "date_selector": ".date em, .date",
            "date_format": "dot",
            "image_selector": ".event_img img",
            "onclick_pattern": r"view\.view\((?P<id>\d+)\)",
            "detail_url_template": f"{_get_root_url(candidate_url)}/eventView?eventIdx={{external_id}}",
            "default_category": "이벤트",
            "summary_fallback": "{brand} 공식 이벤트",
            "max_items": 40,
            "allow_food_names_without_keyword": True,
            "short_name_max_length": 18,
        },
        discovery_metadata={
            "detected_by": "html_event_card_list",
            "matched_url": candidate_url,
        },
    )


def _detect_generic_media_event_list_source(
    *,
    brand: str,
    source_type: str,
    candidate_url: str,
    soup: BeautifulSoup,
    notes: list[str],
) -> NewProductSourceDefinition | None:
    selector_candidates = (
        ".event ul > li",
        ".event_wrap ul > li",
        ".event-list ul > li",
        ".board-event ul > li",
    )
    matched_selector = None
    items = []

    for selector in selector_candidates:
        current_items = soup.select(selector)
        if len(current_items) < 3:
            continue

        valid_items = 0
        for item in current_items[:6]:
            title = item.select_one(".event-text .t1, .event-text .title, .title .t1")
            date = item.select_one(".event-text .t2, .date")
            image = item.select_one(".figure img, img")
            if title and date and image:
                valid_items += 1

        if valid_items < 3:
            continue

        matched_selector = selector
        items = current_items
        break

    if not matched_selector or not items:
        return None

    notes.append("미디어형 공식 이벤트 목록을 탐지해 html_media_event_list parser를 적용했습니다.")
    return _build_admin_source_definition(
        brand=brand,
        source_type=source_type,
        channel="이벤트",
        site_url=_get_root_url(candidate_url),
        crawl_url=candidate_url,
        parser_type="html_media_event_list",
        parser_config={
            "item_selector": matched_selector,
            "detail_link_selector": ".figure a[href], .event-text a[href], a[href]",
            "title_selector": ".event-text .t1, .event-text .title, .title .t1",
            "date_selector": ".event-text .t2, .date",
            "image_selector": ".figure img, img",
            "date_format": "dot",
            "default_category": "이벤트",
            "summary_fallback": "{brand} 공식 이벤트",
            "max_items": 40,
        },
        discovery_metadata={
            "detected_by": "html_media_event_list",
            "matched_url": candidate_url,
        },
    )


async def discover_new_product_source(
    *,
    brand: str,
    source_type: str = "franchise",
    sector_key: str | None = None,
) -> DiscoveredNewProductSource:
    normalized_brand = brand.strip()
    if not normalized_brand:
        raise ValueError("브랜드명을 입력해 주세요.")

    direct_match = _looks_like_builtin_brand(normalized_brand, source_type)
    if direct_match:
        return DiscoveredNewProductSource(
            source=_apply_manual_sector(direct_match, sector_key),
            matched_url=direct_match.crawl_url,
            official_site_url=direct_match.site_url,
            confidence=0.99,
            search_queries=[],
            notes=["등록된 parser preset과 브랜드명이 일치해 바로 연결했습니다."],
        )

    timeout = httpx.Timeout(20.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        search_queries, candidate_urls = await _search_candidate_urls(
            client,
            brand=normalized_brand,
            source_type=source_type,
        )

        for candidate_url in candidate_urls[:12]:
            try:
                soup = await _fetch_soup(client, candidate_url)
            except Exception:
                continue

            internal_links = _collect_internal_links(soup, candidate_url)
            builtin_match = _match_builtin_source_from_urls(
                candidate_url,
                source_type=source_type,
                internal_links=internal_links,
            )
            if builtin_match:
                source, matched_url, notes = builtin_match
                return DiscoveredNewProductSource(
                    source=_apply_manual_sector(source, sector_key),
                    matched_url=matched_url,
                    official_site_url=source.site_url,
                    confidence=0.92,
                    search_queries=search_queries,
                    notes=notes,
                )

            notes: list[str] = []
            generic_board_source = _detect_generic_board_news_source(
                brand=normalized_brand,
                source_type=source_type,
                candidate_url=candidate_url,
                soup=soup,
                notes=notes,
            )
            if generic_board_source:
                return DiscoveredNewProductSource(
                    source=_apply_manual_sector(generic_board_source, sector_key),
                    matched_url=candidate_url,
                    official_site_url=candidate_url,
                    confidence=0.74,
                    search_queries=search_queries,
                    notes=notes,
                )

            grid_notes: list[str] = []
            generic_grid_source = _detect_generic_card_news_grid_source(
                brand=normalized_brand,
                source_type=source_type,
                candidate_url=candidate_url,
                soup=soup,
                notes=grid_notes,
            )
            if generic_grid_source:
                return DiscoveredNewProductSource(
                    source=_apply_manual_sector(generic_grid_source, sector_key),
                    matched_url=candidate_url,
                    official_site_url=candidate_url,
                    confidence=0.76,
                    search_queries=search_queries,
                    notes=grid_notes,
                )

            event_notes: list[str] = []
            generic_event_source = _detect_generic_event_card_list_source(
                brand=normalized_brand,
                source_type=source_type,
                candidate_url=candidate_url,
                soup=soup,
                notes=event_notes,
            )
            if generic_event_source:
                return DiscoveredNewProductSource(
                    source=_apply_manual_sector(generic_event_source, sector_key),
                    matched_url=candidate_url,
                    official_site_url=generic_event_source.site_url,
                    confidence=0.78,
                    search_queries=search_queries,
                    notes=event_notes,
                )

            media_event_notes: list[str] = []
            generic_media_event_source = _detect_generic_media_event_list_source(
                brand=normalized_brand,
                source_type=source_type,
                candidate_url=candidate_url,
                soup=soup,
                notes=media_event_notes,
            )
            if generic_media_event_source:
                return DiscoveredNewProductSource(
                    source=_apply_manual_sector(generic_media_event_source, sector_key),
                    matched_url=candidate_url,
                    official_site_url=generic_media_event_source.site_url,
                    confidence=0.75,
                    search_queries=search_queries,
                    notes=media_event_notes,
                )

            for internal_url in internal_links[:6]:
                try:
                    internal_soup = await _fetch_soup(client, internal_url)
                except Exception:
                    continue

                builtin_internal_match = _match_builtin_source_from_urls(
                    internal_url,
                    source_type=source_type,
                    internal_links=None,
                )
                if builtin_internal_match:
                    source, matched_url, notes = builtin_internal_match
                    return DiscoveredNewProductSource(
                        source=_apply_manual_sector(source, sector_key),
                        matched_url=matched_url,
                        official_site_url=source.site_url,
                        confidence=0.9,
                        search_queries=search_queries,
                        notes=notes,
                    )

                internal_notes: list[str] = []
                generic_internal_source = _detect_generic_board_news_source(
                    brand=normalized_brand,
                    source_type=source_type,
                    candidate_url=internal_url,
                    soup=internal_soup,
                    notes=internal_notes,
                )
                if generic_internal_source:
                    return DiscoveredNewProductSource(
                        source=_apply_manual_sector(generic_internal_source, sector_key),
                        matched_url=internal_url,
                        official_site_url=candidate_url,
                        confidence=0.72,
                        search_queries=search_queries,
                        notes=internal_notes,
                    )

                internal_grid_notes: list[str] = []
                generic_internal_grid_source = _detect_generic_card_news_grid_source(
                    brand=normalized_brand,
                    source_type=source_type,
                    candidate_url=internal_url,
                    soup=internal_soup,
                    notes=internal_grid_notes,
                )
                if generic_internal_grid_source:
                    return DiscoveredNewProductSource(
                        source=_apply_manual_sector(
                            generic_internal_grid_source,
                            sector_key,
                        ),
                        matched_url=internal_url,
                        official_site_url=candidate_url,
                        confidence=0.74,
                        search_queries=search_queries,
                        notes=internal_grid_notes,
                    )

                internal_event_notes: list[str] = []
                generic_internal_event_source = _detect_generic_event_card_list_source(
                    brand=normalized_brand,
                    source_type=source_type,
                    candidate_url=internal_url,
                    soup=internal_soup,
                    notes=internal_event_notes,
                )
                if generic_internal_event_source:
                    return DiscoveredNewProductSource(
                        source=_apply_manual_sector(
                            generic_internal_event_source,
                            sector_key,
                        ),
                        matched_url=internal_url,
                        official_site_url=generic_internal_event_source.site_url,
                        confidence=0.76,
                        search_queries=search_queries,
                        notes=internal_event_notes,
                    )

                internal_media_event_notes: list[str] = []
                generic_internal_media_event_source = _detect_generic_media_event_list_source(
                    brand=normalized_brand,
                    source_type=source_type,
                    candidate_url=internal_url,
                    soup=internal_soup,
                    notes=internal_media_event_notes,
                )
                if generic_internal_media_event_source:
                    return DiscoveredNewProductSource(
                        source=_apply_manual_sector(
                            generic_internal_media_event_source,
                            sector_key,
                        ),
                        matched_url=internal_url,
                        official_site_url=generic_internal_media_event_source.site_url,
                        confidence=0.73,
                        search_queries=search_queries,
                        notes=internal_media_event_notes,
                    )

    raise ValueError("지원 가능한 공식 신상 소스를 찾지 못했습니다. 현재는 등록된 parser preset, 테이블형 공지, 웹진형 뉴스, 카드형 이벤트, 미디어형 이벤트 페이지까지 자동 등록됩니다.")
