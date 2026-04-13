from __future__ import annotations

from copy import deepcopy
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from crawlers.new_product_sources import SOURCE_DEFINITIONS, NewProductSourceDefinition
from config import settings
from database import (
    create_new_product_crawl_run,
    expire_new_products,
    expire_new_products_by_source_id,
    get_new_products_by_source_id,
    list_new_product_sources,
    list_runtime_new_product_sources,
    update_new_product_crawl_run,
    update_new_product_source,
    upsert_new_product_source,
    upsert_new_products,
)

logger = logging.getLogger(__name__)

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
    )
}
NEW_PRODUCT_KEYWORDS = ("출시", "신메뉴", "신제품", "런칭", "론칭")
NON_FOOD_KEYWORDS = (
    "굿즈",
    "머그",
    "텀블러",
    "키링",
    "스티커",
    "쿠폰",
    "할인",
    "단체주문",
    "안내",
    "결과 발표",
)
SOURCE_DEFINITION_MAP = {
    source.source_key: source
    for source in SOURCE_DEFINITIONS
}
@dataclass(slots=True)
class ParsedNewProduct:
    external_id: str
    name: str
    brand: str
    source_type: str
    channel: str
    category: str | None
    summary: str | None
    image_url: str | None
    product_url: str | None
    published_at: str | None
    available_from: str | None
    available_to: str | None
    is_limited: bool
    is_food: bool
    raw_payload: dict[str, Any]

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_datetime(value: str | None, formats: tuple[str, ...]) -> str | None:
    if not value:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    for date_format in formats:
        try:
            parsed = datetime.strptime(normalized, date_format)
        except ValueError:
            continue
        return parsed.replace(tzinfo=timezone.utc).isoformat()

    return None


def _parse_dot_date(value: str | None) -> str | None:
    return _parse_datetime(value, ("%Y.%m.%d",))


def _parse_short_dot_date(value: str | None) -> str | None:
    return _parse_datetime(value, ("%y.%m.%d",))


def _parse_short_dash_date(value: str | None) -> str | None:
    return _parse_datetime(value, ("%y-%m-%d",))


def _parse_dot_date_end(value: str | None) -> str | None:
    parsed = _parse_dot_date(value)
    if not parsed:
        return None

    date_value = datetime.fromisoformat(parsed)
    return date_value.replace(hour=23, minute=59, second=59).isoformat()


def _parse_dash_date(value: str | None) -> str | None:
    return _parse_datetime(value, ("%Y-%m-%d",))


def _parse_dash_datetime(value: str | None) -> str | None:
    return _parse_datetime(value, ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"))


def _parse_dash_date_end(value: str | None) -> str | None:
    parsed = _parse_dash_date(value)
    if not parsed:
        return None

    date_value = datetime.fromisoformat(parsed)
    return date_value.replace(hour=23, minute=59, second=59).isoformat()


def _parse_compact_date(value: str | None) -> str | None:
    return _parse_datetime(value, ("%Y%m%d",))


def _parse_compact_date_end(value: str | None) -> str | None:
    parsed = _parse_compact_date(value)
    if not parsed:
        return None

    date_value = datetime.fromisoformat(parsed)
    return date_value.replace(hour=23, minute=59, second=59).isoformat()


def _parse_unix_seconds(value: str | None) -> str | None:
    if not value:
        return None

    normalized = value.strip()
    if not normalized.isdigit():
        return None

    try:
        parsed = datetime.fromtimestamp(int(normalized), tz=timezone.utc)
    except (ValueError, OSError):
        return None

    return parsed.isoformat()


def _parse_month_day_range(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None

    match = re.search(
        r"(?P<start_month>\d{1,2})\s*/\s*(?P<start_day>\d{1,2})\s*~\s*"
        r"(?P<end_month>\d{1,2})\s*/\s*(?P<end_day>\d{1,2})",
        value,
    )
    if not match:
        return None, None

    now = datetime.now(timezone.utc)
    start_month = int(match.group("start_month"))
    start_day = int(match.group("start_day"))
    end_month = int(match.group("end_month"))
    end_day = int(match.group("end_day"))

    start_year = now.year
    if start_month - now.month > 6:
        start_year -= 1

    end_year = start_year
    if (end_month, end_day) < (start_month, start_day):
        end_year += 1

    start_at = datetime(
        start_year,
        start_month,
        start_day,
        tzinfo=timezone.utc,
    ).isoformat()
    end_at = datetime(
        end_year,
        end_month,
        end_day,
        23,
        59,
        59,
        tzinfo=timezone.utc,
    ).isoformat()
    return start_at, end_at


def _looks_like_food(name: str) -> bool:
    normalized = re.sub(r"\s+", "", name).lower()
    return not any(keyword in normalized for keyword in NON_FOOD_KEYWORDS)


def _has_new_product_keyword(text: str) -> bool:
    return any(keyword in text for keyword in NEW_PRODUCT_KEYWORDS)


def _contains_any_keyword(text: str, keywords: tuple[str, ...] | list[str]) -> bool:
    return any(keyword and keyword in text for keyword in keywords)


def _passes_title_filters(
    title: str,
    *,
    require_keyword: bool = True,
    allow_food_names_without_keyword: bool = False,
    short_name_max_length: int = 16,
    name_hint_keywords: tuple[str, ...] | list[str] = (),
    title_block_keywords: tuple[str, ...] | list[str] = (),
) -> bool:
    normalized_title = _normalize_text(title)
    if not normalized_title or not _looks_like_food(normalized_title):
        return False

    if _contains_any_keyword(normalized_title, title_block_keywords):
        return False

    if _has_new_product_keyword(normalized_title):
        return True

    if require_keyword and not allow_food_names_without_keyword:
        return False

    if short_name_max_length > 0 and len(normalized_title) > short_name_max_length:
        return False

    if name_hint_keywords and not _contains_any_keyword(normalized_title, name_hint_keywords):
        return False

    return True


def _normalize_brand_label(label: str) -> str:
    normalized = re.sub(r"\s+", " ", label).strip()
    normalized = re.sub(r"\s+(배달.*|픽업.*|매장.*)$", "", normalized).strip()
    return normalized


def _normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _get_parser_config(source: NewProductSourceDefinition) -> dict[str, Any]:
    return source.parser_config or {}


def _parse_date_value(value: str | None, format_name: str | None) -> str | None:
    if format_name == "compact":
        return _parse_compact_date(value)
    if format_name == "dash":
        return _parse_dash_date(value)
    if format_name == "dash_datetime":
        return _parse_dash_datetime(value)
    if format_name == "dot":
        return _parse_dot_date(value)
    if format_name == "short_dot":
        return _parse_short_dot_date(value)
    if format_name == "short_dash":
        return _parse_short_dash_date(value)
    if format_name == "unix_seconds":
        return _parse_unix_seconds(value)
    return value if value else None


def _parse_date_end_value(value: str | None, format_name: str | None) -> str | None:
    if format_name == "compact":
        return _parse_compact_date_end(value)
    if format_name == "dash":
        return _parse_dash_date_end(value)
    if format_name == "dash_datetime":
        return _parse_dash_datetime(value)
    if format_name == "dot":
        return _parse_dot_date_end(value)
    if format_name == "short_dot":
        return _parse_short_dot_date(value)
    if format_name == "short_dash":
        return _parse_short_dash_date(value)
    return value if value else None


def _extract_date_range_values(
    value: str | None,
    format_name: str | None,
) -> tuple[str | None, str | None]:
    if not value:
        return None, None

    date_matches = re.findall(r"\d{2,4}[.-]\d{1,2}[.-]\d{1,2}", value)
    if not date_matches:
        return None, None

    available_from = _parse_date_value(date_matches[0], format_name)
    available_to = (
        _parse_date_end_value(date_matches[1], format_name)
        if len(date_matches) > 1
        else None
    )
    return available_from, available_to


def _extract_detail_published_at(detail_soup: BeautifulSoup | Any) -> str | None:
    if not detail_soup:
        return None

    meta_published = detail_soup.select_one(
        'meta[property="article:published_time"], meta[name="article:published_time"]'
    )
    meta_value = meta_published.get("content", "").strip() if meta_published else ""
    if meta_value:
        return meta_value

    text_candidates = [
        _normalize_text(node.get_text(" ", strip=True))
        for node in detail_soup.select(
            ".date, .if_date, .write_info, .view_info, .board_view, .board_info"
        )
    ]
    text_candidates.append(_normalize_text(detail_soup.get_text(" ", strip=True)))

    for text in text_candidates:
        if not text:
            continue

        match = re.search(r"\b\d{2}\.\d{2}\.\d{2}\b", text)
        if match:
            published_at = _parse_date_value(match.group(0), "short_dot")
            if published_at:
                return published_at

        match = re.search(r"\b\d{2}-\d{2}-\d{2}\b", text)
        if match:
            published_at = _parse_date_value(match.group(0), "short_dash")
            if published_at:
                return published_at

        match = re.search(r"\b20\d{2}[.-]\d{1,2}[.-]\d{1,2}\b", text)
        if match:
            date_text = match.group(0)
            published_at = _parse_date_value(
                date_text,
                "dot" if "." in date_text else "dash",
            )
            if published_at:
                return published_at

    return None


def _get_nested_value(payload: Any, path: str | None) -> Any:
    if not path:
        return payload

    current: Any = payload
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _extract_direct_text(element: BeautifulSoup | Any) -> str:
    if not element:
        return ""

    direct_text = "".join(
        text
        for text in element.find_all(string=True, recursive=False)
        if isinstance(text, str)
    )
    return _normalize_text(direct_text) or _normalize_text(element.get_text(" ", strip=True))


def _is_recent_or_active(
    published_at: str | None,
    available_to: str | None = None,
) -> bool:
    if available_to and datetime.fromisoformat(available_to) >= datetime.now(timezone.utc):
        return True

    if not published_at:
        return True

    published_dt = datetime.fromisoformat(published_at)
    return (
        datetime.now(timezone.utc) - published_dt
    ).days <= settings.NEW_PRODUCTS_LOOKBACK_DAYS


def _build_absolute_url(base_url: str, maybe_relative_url: str | None) -> str | None:
    if not maybe_relative_url:
        return None
    return urljoin(base_url, maybe_relative_url)


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        response = await client.get(url, headers=REQUEST_HEADERS)
        response.raise_for_status()
        return response.text
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
        return insecure_response.text


async def _fetch_soup(client: httpx.AsyncClient, url: str) -> BeautifulSoup:
    html = await _fetch_text(client, url)
    return BeautifulSoup(html, "html.parser")


def _extract_first_matching_image(
    soup: BeautifulSoup,
    *,
    base_url: str,
    markers: tuple[str, ...],
) -> str | None:
    for image in soup.find_all("img", src=True):
        src = image.get("src", "").strip()
        if not src:
            continue
        if markers and not any(marker in src for marker in markers):
            continue
        return _build_absolute_url(base_url, src)

    return None


def _extract_meta_image(soup: BeautifulSoup, *, base_url: str) -> str | None:
    meta_image = soup.select_one('meta[property="og:image"]')
    if not meta_image:
        return None

    image_url = meta_image.get("content", "").strip()
    return _build_absolute_url(base_url, image_url)


def _extract_kfc_summary(soup: BeautifulSoup) -> str | None:
    text = soup.get_text("\n", strip=True)
    launch_menu_match = re.search(r"\*출시 메뉴:\s*([^\n*]+)", text)
    if launch_menu_match:
        return f"출시 메뉴: {launch_menu_match.group(1).strip()}"

    launch_channel_match = re.search(r"\*출시 채널:\s*([^\n*]+)", text)
    if launch_channel_match:
        return f"출시 채널: {launch_channel_match.group(1).strip()}"

    return None


def _extract_text_lines_from_html(content_html: str | None) -> list[str]:
    if not content_html:
        return []

    soup = BeautifulSoup(content_html, "html.parser")
    text = soup.get_text("\n", strip=True)
    return [
        normalized
        for line in text.splitlines()
        if (normalized := _normalize_text(line))
    ]


def _extract_mcdonalds_summary(content_html: str | None) -> str | None:
    new_product_lines: list[str] = []
    for line in _extract_text_lines_from_html(content_html):
        if "신제품" not in line:
            continue

        summary_line = _normalize_text(line.replace("신제품", ""))
        if not summary_line:
            continue
        if summary_line in new_product_lines:
            continue
        new_product_lines.append(summary_line)

    if new_product_lines:
        return f"출시 메뉴: {' · '.join(new_product_lines[:3])}"

    return None


def _resolve_nuxt_reference(
    value: Any,
    root: list[Any],
    cache: dict[int, Any],
    stack: set[int] | None = None,
) -> Any:
    if isinstance(value, bool) or value is None:
        return value

    if stack is None:
        stack = set()

    if isinstance(value, int) and 0 <= value < len(root):
        if value in cache:
            return cache[value]
        if value in stack:
            return root[value]

        stack.add(value)
        resolved = _resolve_nuxt_reference(root[value], root, cache, stack)
        stack.remove(value)
        cache[value] = resolved
        return resolved

    if isinstance(value, list):
        return [_resolve_nuxt_reference(item, root, cache, stack) for item in value]

    if isinstance(value, dict):
        return {
            key: _resolve_nuxt_reference(item, root, cache, stack)
            for key, item in value.items()
        }

    return value


def _extract_mcdonalds_promotions(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    payload_element = soup.select_one("#__NUXT_DATA__")
    if not payload_element:
        return []

    payload = json.loads(payload_element.get_text())
    if not isinstance(payload, list) or len(payload) < 4:
        return []

    promotion_ref = payload[3].get("promotionData") if isinstance(payload[3], dict) else None
    if promotion_ref is None:
        return []

    resolved = _resolve_nuxt_reference(promotion_ref, payload, cache={})
    result_object = resolved.get("resultObject") if isinstance(resolved, dict) else None
    items = result_object.get("list") if isinstance(result_object, dict) else None
    return items if isinstance(items, list) else []


def _parse_mega_uploaded_at(image_url: str | None) -> str | None:
    if not image_url:
        return None

    match = re.search(r"/(\d{8})\d{6}_", image_url)
    if not match:
        return None

    return _parse_compact_date(match.group(1))


def _parse_momstouch_uploaded_at(image_url: str | None) -> str | None:
    if not image_url:
        return None

    match = re.search(r"/(\d{10})-[A-Z0-9]+\.", image_url)
    if not match:
        return None

    return _parse_unix_seconds(match.group(1))


def _parse_dominos_uploaded_at(image_url: str | None) -> str | None:
    if not image_url:
        return None

    match = re.search(r"/(\d{8})_[A-Za-z0-9]+\.", image_url)
    if not match:
        return None

    return _parse_compact_date(match.group(1))


def _extract_background_image_url(style: str | None) -> str | None:
    if not style:
        return None

    match = re.search(r"url\((['\"]?)([^'\")]+)\1\)", style)
    if not match:
        return None

    return match.group(2)


def _extract_dominos_detail_url(href: str | None, *, base_url: str) -> str | None:
    if not href:
        return None

    relative_match = re.search(r"(/goods/detail\?[^'\")]+)", href)
    if relative_match:
        return _build_absolute_url(base_url, relative_match.group(1))

    detail_match = re.search(r"(detail\?[^'\")]+)", href)
    if detail_match:
        return urljoin("https://web.dominos.co.kr/goods/", detail_match.group(1))

    return _build_absolute_url(base_url, href)


def _build_stable_external_id(
    *,
    source: NewProductSourceDefinition,
    detail_url: str | None,
    image_url: str | None,
    name: str,
) -> str:
    if detail_url:
        parsed = urlparse(detail_url)
        query = f"?{parsed.query}" if parsed.query else ""
        return f"url::{parsed.netloc.lower()}{parsed.path}{query}"
    if image_url:
        return f"img::{image_url}"
    return f"{source.source_key}::{_normalize_text(name)}"


def _parse_image_timestamp(
    image_url: str | None,
    *,
    pattern: str | None,
    source_type: str | None,
) -> str | None:
    if not image_url or not pattern or not source_type:
        return None

    match = re.search(pattern, image_url)
    if not match:
        return None

    raw_value = match.group(1)
    return _parse_date_value(raw_value, source_type)


def _resolve_timestamp_format(source_name: str | None) -> str | None:
    if source_name == "asset_upload_unix":
        return "unix_seconds"
    if source_name == "asset_upload_ymd":
        return "compact"
    if source_name == "explicit":
        return None
    return source_name


def _format_template_value(template: str | None, **kwargs: str) -> str | None:
    if not template:
        return None
    return template.format(**kwargs)


def _extract_image_from_element(
    element: BeautifulSoup | Any,
    *,
    source: NewProductSourceDefinition,
    config: dict[str, Any],
) -> str | None:
    style_selector = config.get("image_style_selector")
    if style_selector:
        style_element = element.select_one(str(style_selector))
        image_style = (
            style_element.get(str(config.get("image_style_attr", "style")), "")
            if style_element
            else None
        )
        return _build_absolute_url(
            source.site_url,
            _extract_background_image_url(image_style),
        )

    image_selector = config.get("image_selector")
    if not image_selector:
        return None

    image_element = element.select_one(str(image_selector))
    if not image_element:
        return None

    image_attr_order = tuple(config.get("image_attr_order") or ("src",))
    image_path = None
    for attr_name in image_attr_order:
        attr_value = image_element.get(str(attr_name))
        if attr_value:
            image_path = str(attr_value)
            break

    return _build_absolute_url(source.site_url, image_path)


def _open_ended_datetime() -> str:
    return datetime(9999, 12, 31, 23, 59, 59, tzinfo=timezone.utc).isoformat()


async def _crawl_emart24_fresh_food(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    products: list[ParsedNewProduct] = []
    max_pages = int(_get_parser_config(source).get("max_pages", 3))

    for page in range(1, max_pages + 1):
        params = {"page": page}
        html = await _fetch_text(client, f"{source.crawl_url}?{urlencode(params)}")
        soup = BeautifulSoup(html, "html.parser")
        items = soup.select(".itemWrap")
        if not items:
            break

        added_in_page = 0
        for item in items:
            badge = item.select_one(".itemTit span")
            badge_text = badge.get_text(" ", strip=True) if badge else ""
            if "NEW" not in badge_text.upper():
                continue

            name_element = item.select_one(".itemtitle a")
            price_element = item.select_one(".price")
            image_element = item.select_one(".itemSpImg img")

            name = name_element.get_text(" ", strip=True) if name_element else ""
            if not name:
                continue

            image_url = _build_absolute_url(
                source.site_url,
                image_element.get("src") if image_element else None,
            )
            external_id = (
                (image_url or "").rstrip("/").rsplit("/", 1)[-1]
                or f"emart24::{page}::{name}"
            )
            price_text = price_element.get_text(" ", strip=True) if price_element else None

            products.append(
                ParsedNewProduct(
                    external_id=external_id,
                    name=name,
                    brand=source.brand,
                    source_type=source.source_type,
                    channel=source.channel,
                    category="Fresh Food",
                    summary=f"{source.title} 신상품{f' · {price_text}' if price_text else ''}",
                    image_url=image_url,
                    product_url=source.site_url,
                    published_at=None,
                    available_from=None,
                    available_to=None,
                    is_limited=False,
                    is_food=True,
                    raw_payload={
                        "page": page,
                        "badge": badge_text,
                        "price": price_text,
                    },
                )
            )
            added_in_page += 1

        if added_in_page == 0:
            break

    return products


def _parse_lotteeatz_period(period_text: str) -> tuple[str | None, str | None]:
    parts = [part.strip() for part in period_text.split("~", 1)]
    if len(parts) != 2:
        return None, None

    start_at = _parse_dot_date(parts[0])
    end_at = _parse_dot_date_end(parts[1])
    if parts[1].startswith(("2999", "9999")):
        end_at = None

    return start_at, end_at


async def _crawl_lotteeatz_launch_events(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    max_items = int(_get_parser_config(source).get("max_items", 40))

    for item in soup.select("li.grid-item")[:max_items]:
        title_element = item.select_one(".grid-title")
        period_element = item.select_one(".grid-period")
        link_element = item.select_one('a[href*="/event/main/selectEvent/"]')
        image_element = item.select_one("img")
        badge_element = item.select_one('[class*="badge"]')

        title = title_element.get_text(" ", strip=True) if title_element else ""
        if not title or not _has_new_product_keyword(title):
            continue
        if not _looks_like_food(title):
            continue

        brand = _normalize_brand_label(
            badge_element.get_text(" ", strip=True) if badge_element else source.brand
        )
        href = link_element.get("href") if link_element else ""
        external_id = href.rstrip("/").rsplit("/", 1)[-1] if href else title
        available_from, available_to = _parse_lotteeatz_period(
            period_element.get_text(" ", strip=True) if period_element else ""
        )
        if not _is_recent_or_active(available_from, available_to):
            continue

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=brand or source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category="신제품 이벤트",
                summary=f"{brand or source.brand} 공식 신제품 공지",
                image_url=_build_absolute_url(
                    source.site_url,
                    image_element.get("src") if image_element else None,
                ),
                product_url=_build_absolute_url(source.site_url, href) or source.site_url,
                published_at=available_from,
                available_from=available_from,
                available_to=available_to,
                is_limited=available_to is not None,
                is_food=True,
                raw_payload={
                    "period": period_element.get_text(" ", strip=True)
                    if period_element
                    else None,
                    "brand_label": badge_element.get_text(" ", strip=True)
                    if badge_element
                    else None,
                },
            )
        )

    return products


async def _crawl_paikdabang_news(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    return await _crawl_html_board_news_table(client, source)


async def _crawl_html_board_news_table(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    max_items = int(config.get("max_items", 40))
    row_selector = str(config.get("row_selector") or ".board_wrap table tbody tr")
    min_cell_count = int(config.get("min_cell_count", 4))
    category_cell_index = int(config.get("category_cell_index", -1))
    title_cell_index = int(config.get("title_cell_index", 2))
    date_cell_index = int(config.get("date_cell_index", -1))
    detail_link_selector = str(config.get("detail_link_selector") or "a[href]")
    onclick_pattern = str(config.get("onclick_pattern") or "")
    required_category = _normalize_text(str(config.get("required_category") or ""))
    default_category = str(config.get("default_category") or "신메뉴 소식")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 소식")
    detail_image_markers = tuple(config.get("detail_image_markers") or ("/wp-content/uploads/",))
    date_format = str(config.get("date_format") or "dash")
    detail_date_required = bool(config.get("detail_date_required", False))

    for row in soup.select(row_selector)[:max_items]:
        cells = row.find_all("td")
        if len(cells) < min_cell_count:
            continue

        required_indices = [title_cell_index]
        if category_cell_index >= 0:
            required_indices.append(category_cell_index)
        if date_cell_index >= 0:
            required_indices.append(date_cell_index)
        if max(required_indices) >= len(cells):
            continue

        category_text = (
            cells[category_cell_index].get_text(" ", strip=True)
            if category_cell_index >= 0
            else ""
        )
        title_link = cells[title_cell_index].select_one(detail_link_selector)
        title = title_link.get_text(" ", strip=True) if title_link else cells[title_cell_index].get_text(" ", strip=True)
        published_at = (
            _parse_date_value(
                cells[date_cell_index].get_text(" ", strip=True),
                date_format,
            )
            if date_cell_index >= 0
            else None
        )
        if required_category and _normalize_text(category_text) != required_category:
            continue
        if not title or not _has_new_product_keyword(title):
            continue
        if not _looks_like_food(title):
            continue

        detail_url = _build_absolute_url(source.site_url, title_link.get("href")) if title_link else None
        if not detail_url and onclick_pattern:
            onclick_value = row.get("onclick", "")
            onclick_match = re.search(onclick_pattern, onclick_value)
            if onclick_match:
                detail_href = onclick_match.groupdict().get("href") or onclick_match.group(1)
                detail_url = _build_absolute_url(source.site_url, detail_href)
        detail_soup = await _fetch_soup(client, detail_url) if detail_url else None
        if not published_at and detail_soup:
            published_at = _extract_detail_published_at(detail_soup)
        if detail_date_required and not published_at:
            continue
        if not _is_recent_or_active(published_at):
            continue
        image_url = (
            _extract_first_matching_image(
                detail_soup,
                base_url=detail_url or source.site_url,
                markers=detail_image_markers,
            )
            if detail_soup
            else None
        )
        external_id = (
            (detail_url or "").rstrip("/").rsplit("/", 1)[-1]
            or f"paikdabang::{title}"
        )

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=default_category,
                summary=_format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=default_category,
                ),
                image_url=image_url,
                product_url=detail_url or source.site_url,
                published_at=published_at,
                available_from=published_at,
                available_to=None,
                is_limited=False,
                is_food=True,
                raw_payload={
                    "row_category": category_text,
                    "listed_at": (
                        cells[date_cell_index].get_text(" ", strip=True)
                        if date_cell_index >= 0
                        else None
                    ),
                },
            )
        )

    return products


async def _crawl_kfc_new_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    max_items = int(_get_parser_config(source).get("max_items", 20))

    for item in soup.select('.list li a[href*="/promotion/newMenu/detail/"]')[:max_items]:
        title_element = item.select_one(".title")
        date_element = item.select_one(".date")

        title = title_element.get_text(" ", strip=True) if title_element else ""
        period_text = date_element.get_text(" ", strip=True) if date_element else ""
        if not title or not _has_new_product_keyword(title):
            continue
        if not _looks_like_food(title):
            continue

        available_from, available_to = _parse_month_day_range(period_text)
        if not _is_recent_or_active(available_from, available_to):
            continue

        detail_url = _build_absolute_url(source.site_url, item.get("href")) or source.site_url
        detail_soup = await _fetch_soup(client, detail_url)
        image_url = _extract_meta_image(detail_soup, base_url=detail_url) or _extract_first_matching_image(
            detail_soup,
            base_url=detail_url,
            markers=("/nas/event/",),
        )
        summary = _extract_kfc_summary(detail_soup) or f"{source.brand} 공식 신메뉴"
        external_id = detail_url.rstrip("/").rsplit("/", 1)[-1] or title

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category="신메뉴",
                summary=summary,
                image_url=image_url,
                product_url=detail_url,
                published_at=available_from,
                available_from=available_from,
                available_to=available_to,
                is_limited=available_to is not None,
                is_food=True,
                raw_payload={
                    "listed_period": period_text,
                },
            )
        )

    return products


async def _crawl_html_card_news_grid(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    max_items = int(config.get("max_items", 40))
    item_selector = str(config.get("item_selector") or "")
    detail_link_selector = str(config.get("detail_link_selector") or "a[href]")
    title_selector = str(config.get("title_selector") or "")
    date_selector = str(config.get("date_selector") or "")
    date_format = str(config.get("date_format") or "dash")
    default_category = str(config.get("default_category") or "신메뉴 소식")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 소식")
    require_keyword = bool(config.get("require_keyword", True))
    allow_food_names_without_keyword = bool(
        config.get("allow_food_names_without_keyword", False)
    )
    short_name_max_length = int(config.get("short_name_max_length", 16))
    name_hint_keywords = tuple(config.get("name_hint_keywords") or ())
    title_block_keywords = tuple(config.get("title_block_keywords") or ())

    if not item_selector or not title_selector or not date_selector:
        return []

    for item in soup.select(item_selector)[:max_items]:
        title_element = item.select_one(title_selector)
        title = _normalize_text(title_element.get_text(" ", strip=True) if title_element else "")
        if not _passes_title_filters(
            title,
            require_keyword=require_keyword,
            allow_food_names_without_keyword=allow_food_names_without_keyword,
            short_name_max_length=short_name_max_length,
            name_hint_keywords=name_hint_keywords,
            title_block_keywords=title_block_keywords,
        ):
            continue

        date_text = _normalize_text(
            item.select_one(date_selector).get_text(" ", strip=True)
            if item.select_one(date_selector)
            else ""
        )
        published_at = _parse_date_value(date_text, date_format)
        if published_at and not _is_recent_or_active(published_at):
            continue

        detail_link = item.select_one(detail_link_selector)
        detail_url = _build_absolute_url(
            source.site_url,
            detail_link.get("href") if detail_link else None,
        )
        image_url = _extract_image_from_element(item, source=source, config=config)
        external_id = _build_stable_external_id(
            source=source,
            detail_url=detail_url,
            image_url=image_url,
            name=title,
        )

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=default_category,
                summary=_format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=default_category,
                ),
                image_url=image_url,
                product_url=detail_url or source.site_url,
                published_at=published_at,
                available_from=published_at,
                available_to=None,
                is_limited=False,
                is_food=True,
                raw_payload={
                    "date_text": date_text or None,
                },
            )
        )

    return products


async def _crawl_html_visual_news_cards(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    item_selector = str(config.get("item_selector") or "")
    title_selector = str(config.get("title_selector") or "")
    detail_link_selector = str(config.get("detail_link_selector") or "a[href]")
    image_selector = str(config.get("image_selector") or "img")
    default_category = str(config.get("default_category") or "신메뉴 소식")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 소식")
    max_items = int(config.get("max_items", 40))
    require_keyword = bool(config.get("require_keyword", True))
    allow_food_names_without_keyword = bool(
        config.get("allow_food_names_without_keyword", False)
    )
    short_name_max_length = int(config.get("short_name_max_length", 16))
    name_hint_keywords = tuple(config.get("name_hint_keywords") or ())
    title_block_keywords = tuple(config.get("title_block_keywords") or ())
    detail_date_required = bool(config.get("detail_date_required", True))

    if not item_selector or not title_selector:
        return []

    for item in soup.select(item_selector)[:max_items]:
        title = _normalize_text(
            item.select_one(title_selector).get_text(" ", strip=True)
            if item.select_one(title_selector)
            else ""
        )
        if not _passes_title_filters(
            title,
            require_keyword=require_keyword,
            allow_food_names_without_keyword=allow_food_names_without_keyword,
            short_name_max_length=short_name_max_length,
            name_hint_keywords=name_hint_keywords,
            title_block_keywords=title_block_keywords,
        ):
            continue

        detail_link = item.select_one(detail_link_selector)
        detail_url = _build_absolute_url(
            source.site_url,
            detail_link.get("href") if detail_link else None,
        )
        detail_soup = await _fetch_soup(client, detail_url) if detail_url else None
        published_at = _extract_detail_published_at(detail_soup)
        if detail_date_required and not published_at:
            continue
        if published_at and not _is_recent_or_active(published_at):
            continue

        image_element = item.select_one(image_selector)
        image_url = _build_absolute_url(
            source.site_url,
            image_element.get("src") if image_element else None,
        )
        external_id = _build_stable_external_id(
            source=source,
            detail_url=detail_url,
            image_url=image_url,
            name=title,
        )

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=default_category,
                summary=_format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=default_category,
                ),
                image_url=image_url,
                product_url=detail_url or source.site_url,
                published_at=published_at,
                available_from=published_at,
                available_to=None,
                is_limited=False,
                is_food=True,
                raw_payload={},
            )
        )

    return products


async def _crawl_html_event_card_list(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    item_selector = str(config.get("item_selector") or "")
    title_selector = str(config.get("title_selector") or "")
    date_selector = str(config.get("date_selector") or "")
    date_format = str(config.get("date_format") or "dot")
    image_selector = str(config.get("image_selector") or "img")
    onclick_pattern = str(config.get("onclick_pattern") or "")
    detail_url_template = str(config.get("detail_url_template") or source.site_url)
    default_category = str(config.get("default_category") or "이벤트")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 이벤트")
    max_items = int(config.get("max_items", 40))
    allow_food_names_without_keyword = bool(
        config.get("allow_food_names_without_keyword", True)
    )
    short_name_max_length = int(config.get("short_name_max_length", 16))
    name_hint_keywords = tuple(config.get("name_hint_keywords") or ())
    title_block_keywords = tuple(config.get("title_block_keywords") or ())

    if not item_selector or not title_selector or not date_selector:
        return []

    for item in soup.select(item_selector)[:max_items]:
        title = _normalize_text(
            item.select_one(title_selector).get_text(" ", strip=True)
            if item.select_one(title_selector)
            else ""
        )
        if not _passes_title_filters(
            title,
            require_keyword=True,
            allow_food_names_without_keyword=allow_food_names_without_keyword,
            short_name_max_length=short_name_max_length,
            name_hint_keywords=name_hint_keywords,
            title_block_keywords=title_block_keywords,
        ):
            continue

        anchor = item.find("a")
        onclick = anchor.get("onclick", "") if anchor else ""
        external_id = ""
        if onclick_pattern:
            match = re.search(onclick_pattern, onclick)
            if match:
                external_id = match.group("id")

        date_text = _normalize_text(
            item.select_one(date_selector).get_text(" ", strip=True)
            if item.select_one(date_selector)
            else ""
        )
        date_text = re.sub(r"\s+", " ", date_text)
        open_ended = "~" in date_text and date_text.strip().endswith("~")
        available_from, available_to = _extract_date_range_values(date_text, date_format)
        if not available_from:
            available_from = _parse_date_value(date_text, date_format)
        if open_ended:
            available_to = None
        if available_from and not _is_recent_or_active(available_from, available_to):
            continue

        detail_url = _format_template_value(
            detail_url_template,
            external_id=external_id or "",
            brand=source.brand,
        ) or source.site_url
        image_element = item.select_one(image_selector)
        image_url = _build_absolute_url(
            source.site_url,
            image_element.get("src") if image_element else None,
        )
        final_external_id = external_id or _build_stable_external_id(
            source=source,
            detail_url=detail_url,
            image_url=image_url,
            name=title,
        )

        products.append(
            ParsedNewProduct(
                external_id=final_external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=default_category,
                summary=_format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=default_category,
                ),
                image_url=image_url,
                product_url=detail_url,
                published_at=available_from,
                available_from=available_from,
                available_to=available_to,
                is_limited=open_ended or available_to is not None,
                is_food=True,
                raw_payload={
                    "date_text": date_text or None,
                    "onclick": onclick or None,
                },
            )
        )

    return products


async def _crawl_html_media_event_list(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    item_selector = str(config.get("item_selector") or "")
    detail_link_selector = str(config.get("detail_link_selector") or "a[href]")
    title_selector = str(config.get("title_selector") or "")
    date_selector = str(config.get("date_selector") or "")
    image_selector = str(config.get("image_selector") or "img")
    date_format = str(config.get("date_format") or "dot")
    default_category = str(config.get("default_category") or "이벤트")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 이벤트")
    max_items = int(config.get("max_items", 40))
    require_keyword = bool(config.get("require_keyword", True))
    allow_food_names_without_keyword = bool(
        config.get("allow_food_names_without_keyword", False)
    )
    short_name_max_length = int(config.get("short_name_max_length", 16))
    name_hint_keywords = tuple(config.get("name_hint_keywords") or ())
    title_block_keywords = tuple(config.get("title_block_keywords") or ())

    if not item_selector or not title_selector or not date_selector:
        return []

    for item in soup.select(item_selector)[:max_items]:
        title = _normalize_text(
            item.select_one(title_selector).get_text(" ", strip=True)
            if item.select_one(title_selector)
            else ""
        )
        if not _passes_title_filters(
            title,
            require_keyword=require_keyword,
            allow_food_names_without_keyword=allow_food_names_without_keyword,
            short_name_max_length=short_name_max_length,
            name_hint_keywords=name_hint_keywords,
            title_block_keywords=title_block_keywords,
        ):
            continue

        detail_link = item.select_one(detail_link_selector)
        detail_href = detail_link.get("href") if detail_link else None
        if detail_href and detail_href.startswith("javascript:"):
            detail_href = None
        detail_url = _build_absolute_url(source.site_url, detail_href) or source.site_url

        date_text = _normalize_text(
            item.select_one(date_selector).get_text(" ", strip=True)
            if item.select_one(date_selector)
            else ""
        )
        available_from, available_to = _extract_date_range_values(date_text, date_format)
        if not available_from:
            available_from = _parse_date_value(date_text, date_format)
        if available_from and not _is_recent_or_active(available_from, available_to):
            continue

        image_element = item.select_one(image_selector)
        image_url = _build_absolute_url(
            source.site_url,
            image_element.get("src") if image_element else None,
        )
        external_id = _build_stable_external_id(
            source=source,
            detail_url=detail_url,
            image_url=image_url,
            name=title,
        )

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=default_category,
                summary=_format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=default_category,
                ),
                image_url=image_url,
                product_url=detail_url,
                published_at=available_from,
                available_from=available_from,
                available_to=available_to,
                is_limited=available_to is not None,
                is_food=True,
                raw_payload={
                    "date_text": date_text or None,
                },
            )
        )

    return products


async def _crawl_momstouch_new_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    return await _crawl_html_paged_new_menu(client, source)


async def _crawl_dominos_new_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    return await _crawl_html_badge_menu(client, source)


async def _crawl_mcdonalds_promotion(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    html = await _fetch_text(client, source.crawl_url)
    products: list[ParsedNewProduct] = []
    max_items = int(_get_parser_config(source).get("max_items", 20))

    for item in _extract_mcdonalds_promotions(html)[:max_items]:
        title = BeautifulSoup(str(item.get("title") or ""), "html.parser").get_text(
            " ",
            strip=True,
        )
        content_html = str(item.get("pcKorContent") or "")
        content_text = _normalize_text(
            BeautifulSoup(content_html, "html.parser").get_text(" ", strip=True)
        )
        code = _normalize_text(str(item.get("code") or ""))
        detail_url = (
            f"https://www.mcdonalds.co.kr/kor/promotion/detail/{code}"
            if code
            else source.site_url
        )
        image_url = _build_absolute_url(source.site_url, str(item.get("pcKorImageUrl") or ""))
        extracted_summary = _extract_mcdonalds_summary(content_html)
        combined_text = f"{title} {extracted_summary or ''} {content_text}".strip()
        if not title or not _looks_like_food(f"{title} {extracted_summary or ''}"):
            continue
        if "NEW" not in combined_text.upper() and not _has_new_product_keyword(combined_text):
            continue

        published_at = _parse_dash_date(
            str(item.get("promotionStartDay") or item.get("regDate") or "")
        )
        end_day = str(item.get("promotionEndDay") or "").strip()
        is_open_ended = end_day.startswith("9999")
        available_to = _open_ended_datetime() if is_open_ended else _parse_dash_date_end(end_day)
        if not _is_recent_or_active(published_at, available_to):
            continue
        summary = extracted_summary or f"{source.brand} 공식 신제품 프로모션"

        products.append(
            ParsedNewProduct(
                external_id=code or str(item.get("seq") or title),
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category="프로모션",
                summary=summary,
                image_url=image_url,
                product_url=detail_url,
                published_at=published_at,
                available_from=published_at,
                available_to=available_to,
                is_limited=available_to is not None and not is_open_ended,
                is_food=True,
                raw_payload={
                    "seq": item.get("seq"),
                    "reg_date": item.get("regDate"),
                    "promotion_end_day": end_day or None,
                },
            )
        )

    return products


async def _crawl_starbucks_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    return await _crawl_json_menu_feed(client, source)


async def _crawl_html_paged_new_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    products_by_id: dict[str, ParsedNewProduct] = {}
    max_pages = int(config.get("max_pages", 1))
    item_selector = str(config.get("item_selector") or "")
    id_pattern = str(config.get("id_pattern") or "")
    title_selector = str(config.get("title_selector") or "")
    category_selector = str(config.get("category_selector") or "")
    english_name_selector = str(config.get("english_name_selector") or "")
    summary_selector = str(config.get("summary_selector") or "")
    default_category = str(config.get("default_category") or "신제품 메뉴")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 신제품 메뉴")
    detail_url_template = str(config.get("detail_url_template") or source.site_url)
    timestamp_format = _resolve_timestamp_format(str(config.get("published_at_source") or ""))
    image_timestamp_pattern = str(config.get("image_timestamp_pattern") or "")
    page_param_name = str(config.get("page_param_name") or "pageNo")
    page_separator = "&" if "?" in source.crawl_url else "?"

    if not item_selector or not id_pattern or not title_selector:
        return []

    for page in range(1, max_pages + 1):
        html = await _fetch_text(
            client,
            f"{source.crawl_url}{page_separator}{page_param_name}={page}",
        )
        soup = BeautifulSoup(html, "html.parser")
        items = soup.select(item_selector)
        if not items:
            break

        added_in_page = 0
        for item in items:
            href = item.get("href", "")
            match = re.search(id_pattern, href)
            if not match:
                continue

            external_id = match.group("id")
            title_element = item.select_one(title_selector)
            name = _extract_direct_text(title_element)
            if not name or not _looks_like_food(name):
                continue

            category_text = _normalize_text(
                item.select_one(category_selector).get_text(" ", strip=True)
                if category_selector and item.select_one(category_selector)
                else default_category
            )
            english_name = _normalize_text(
                item.select_one(english_name_selector).get_text(" ", strip=True)
                if english_name_selector and item.select_one(english_name_selector)
                else ""
            )
            if summary_selector:
                summary = _normalize_text(
                    item.select_one(summary_selector).get_text(" ", strip=True)
                    if item.select_one(summary_selector)
                    else ""
                )
            else:
                summary_elements = item.find_all("p")
                summary = _normalize_text(
                    summary_elements[-1].get_text(" ", strip=True)
                    if summary_elements
                    else ""
                )

            image_url = _extract_image_from_element(item, source=source, config=config)
            published_at = _parse_image_timestamp(
                image_url,
                pattern=image_timestamp_pattern or None,
                source_type=timestamp_format,
            )
            if published_at and not _is_recent_or_active(published_at):
                continue

            detail_url = _format_template_value(
                detail_url_template,
                external_id=external_id,
                brand=source.brand,
            ) or source.site_url

            products_by_id[external_id] = ParsedNewProduct(
                external_id=external_id,
                name=name,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=category_text or default_category,
                summary=summary or _format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=category_text or default_category,
                ),
                image_url=image_url,
                product_url=detail_url,
                published_at=published_at,
                available_from=published_at,
                available_to=None,
                is_limited=False,
                is_food=True,
                raw_payload={
                    "page": page,
                    "english_name": english_name or None,
                    "published_at_source": config.get("published_at_source"),
                },
            )
            added_in_page += 1

        if added_in_page == 0:
            break

    return list(products_by_id.values())


async def _crawl_html_badge_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    products_by_id: dict[str, ParsedNewProduct] = {}
    item_selector = str(config.get("item_selector") or "")
    badge_selector = str(config.get("badge_selector") or "")
    badge_text = str(config.get("badge_text") or "NEW").upper()
    detail_link_selector = str(config.get("detail_link_selector") or "")
    external_id_pattern = str(config.get("external_id_pattern") or "")
    title_selector = str(config.get("title_selector") or "")
    hashtag_selector = str(config.get("hashtag_selector") or "")
    default_category = str(config.get("default_category") or "신규 메뉴")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 신규 메뉴")
    summary_hashtag_limit = int(config.get("summary_hashtag_limit", 2))
    scan_limit = int(config.get("scan_limit", 80))
    timestamp_format = _resolve_timestamp_format(str(config.get("published_at_source") or ""))
    image_timestamp_pattern = str(config.get("image_timestamp_pattern") or "")
    category_heading_tags = tuple(config.get("category_heading_tags") or ("h3", "h4"))
    category_exclude_keywords = tuple(config.get("category_exclude_keywords") or ())
    category_max_length = int(config.get("category_max_length", 18))
    detail_href_strategy = str(config.get("detail_href_strategy") or "")

    if not item_selector or not badge_selector or not title_selector or not external_id_pattern:
        return []

    for item in soup.select(item_selector)[:scan_limit]:
        new_label = item.select_one(badge_selector)
        if not new_label or badge_text not in new_label.get_text(" ", strip=True).upper():
            continue

        image_link = item.select_one(detail_link_selector) if detail_link_selector else None
        href = image_link.get("href") if image_link else None
        if detail_href_strategy == "dominos":
            detail_url = _extract_dominos_detail_url(href, base_url=source.site_url)
        else:
            detail_url = _build_absolute_url(source.site_url, href)

        external_id_match = re.search(external_id_pattern, detail_url or "")
        if not external_id_match:
            continue

        external_id = external_id_match.group(1)
        if external_id in products_by_id:
            continue

        name = _extract_direct_text(item.select_one(title_selector))
        if not name or not _looks_like_food(name):
            continue

        image_url = _extract_image_from_element(item, source=source, config=config)
        published_at = _parse_image_timestamp(
            image_url,
            pattern=image_timestamp_pattern or None,
            source_type=timestamp_format,
        )
        if published_at and not _is_recent_or_active(published_at):
            continue

        hashtags = [
            _normalize_text(tag.get_text(" ", strip=True))
            for tag in item.select(hashtag_selector)
            if hashtag_selector and _normalize_text(tag.get_text(" ", strip=True))
        ]
        category_heading = item.find_previous(list(category_heading_tags))
        category = _normalize_text(
            category_heading.get_text(" ", strip=True)
            if category_heading
            else default_category
        )
        if (
            not category
            or any(keyword in category for keyword in category_exclude_keywords)
            or len(category) > category_max_length
        ):
            category = default_category

        products_by_id[external_id] = ParsedNewProduct(
            external_id=external_id,
            name=name,
            brand=source.brand,
            source_type=source.source_type,
            channel=source.channel,
            category=category or default_category,
            summary=" ".join(hashtags[:summary_hashtag_limit]) or _format_template_value(
                summary_fallback,
                brand=source.brand,
                category=category or default_category,
            ),
            image_url=image_url,
            product_url=detail_url or source.site_url,
            published_at=published_at,
            available_from=published_at,
            available_to=None,
            is_limited=False,
            is_food=True,
            raw_payload={
                "hashtags": hashtags,
                "published_at_source": config.get("published_at_source"),
            },
        )

    return list(products_by_id.values())


async def _crawl_html_linked_menu_cards(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    soup = await _fetch_soup(client, source.crawl_url)
    item_selector = str(config.get("item_selector") or "")
    detail_link_selector = str(config.get("detail_link_selector") or "")
    external_id_pattern = str(config.get("external_id_pattern") or "")
    title_selector = str(config.get("title_selector") or "")
    summary_selector = str(config.get("summary_selector") or "")
    default_category = str(config.get("default_category") or "신규 메뉴")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 메뉴")
    max_items = int(config.get("max_items", 40))

    if not item_selector:
        return []

    products_by_id: dict[str, ParsedNewProduct] = {}
    for item in soup.select(item_selector)[: max_items * 3]:
        if detail_link_selector in {":self", "self"} and getattr(item, "name", "") == "a":
            link_element = item
        elif detail_link_selector:
            link_element = item.select_one(detail_link_selector)
        else:
            link_element = item.find("a", href=True)

        if not link_element:
            continue

        href = link_element.get("href", "").strip()
        detail_url = _build_absolute_url(source.site_url, href)
        if not detail_url:
            continue

        if external_id_pattern:
            match = re.search(external_id_pattern, detail_url)
            if not match:
                continue
            external_id = match.groupdict().get("id") or match.group(1)
        else:
            external_id = detail_url

        if external_id in products_by_id:
            continue

        title_element = item.select_one(title_selector) if title_selector else None
        name = _extract_direct_text(title_element) if title_element else ""
        if not name:
            name = _normalize_text(link_element.get("title", ""))
        if not name:
            name = _extract_direct_text(link_element)
        if not name:
            image = item.select_one("img")
            name = _normalize_text(image.get("alt", "") if image else "")
        if not name or not _looks_like_food(name):
            continue

        if summary_selector:
            summary = _normalize_text(
                item.select_one(summary_selector).get_text(" ", strip=True)
                if item.select_one(summary_selector)
                else ""
            )
        else:
            summary = ""

        image_url = _extract_image_from_element(item, source=source, config=config)
        products_by_id[external_id] = ParsedNewProduct(
            external_id=external_id,
            name=name,
            brand=source.brand,
            source_type=source.source_type,
            channel=source.channel,
            category=default_category,
            summary=summary or _format_template_value(
                summary_fallback,
                brand=source.brand,
                category=default_category,
            ),
            image_url=image_url,
            product_url=detail_url,
            published_at=None,
            available_from=None,
            available_to=None,
            is_limited=False,
            is_food=True,
            raw_payload={},
        )

        if len(products_by_id) >= max_items:
            break

    return list(products_by_id.values())


async def _crawl_json_menu_feed(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    products_by_id: dict[str, ParsedNewProduct] = {}
    category_codes = tuple(config.get("category_codes") or ())
    food_category_codes = set(config.get("food_category_codes") or ())
    endpoint_template = str(config.get("endpoint_template") or "")
    request_form = dict(config.get("request_form") or {})
    response_list_key = str(config.get("response_list_key") or "list")
    id_field = str(config.get("id_field") or "id")
    name_field = str(config.get("name_field") or "name")
    category_field = str(config.get("category_field") or "")
    fallback_category_field = str(config.get("fallback_category_field") or "")
    summary_field = str(config.get("summary_field") or "")
    image_field = str(config.get("image_field") or "")
    new_flag_field = str(config.get("new_flag_field") or "")
    new_flag_value = config.get("new_flag_value")
    start_date_field = str(config.get("start_date_field") or "")
    end_date_field = str(config.get("end_date_field") or "")
    food_listing_url = str(config.get("food_listing_url") or source.crawl_url)
    fallback_category = str(config.get("fallback_category") or "신규 메뉴")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 신규 메뉴")
    start_date_format = str(config.get("start_date_format") or "")
    end_date_format = str(config.get("end_date_format") or "")

    for category_code in category_codes:
        endpoint_url = endpoint_template.format(category_code=category_code)
        response = await client.post(
            endpoint_url,
            data={
                field_name: (
                    field_value.format(category_code=category_code)
                    if isinstance(field_value, str)
                    else field_value
                )
                for field_name, field_value in request_form.items()
            },
            headers={
                **REQUEST_HEADERS,
                "Referer": source.crawl_url,
            },
        )
        response.raise_for_status()
        items = response.json().get(response_list_key) or []

        for item in items:
            external_id = _normalize_text(str(item.get(id_field) or ""))
            name = _normalize_text(str(item.get(name_field) or ""))
            if not external_id or not name:
                continue
            if not _looks_like_food(name):
                continue

            published_at = _parse_date_value(str(item.get(start_date_field) or ""), start_date_format)
            available_to = _parse_date_end_value(str(item.get(end_date_field) or ""), end_date_format)
            if new_flag_field and item.get(new_flag_field) != new_flag_value and not published_at:
                continue
            if not _is_recent_or_active(published_at, available_to):
                continue

            category = _normalize_text(
                str(
                    item.get(category_field)
                    or item.get(fallback_category_field)
                    or fallback_category
                )
            ) or fallback_category
            summary = _normalize_text(str(item.get(summary_field) or ""))
            listing_url = (
                food_listing_url
                if category_code in food_category_codes
                else source.crawl_url
            )

            parsed_product = ParsedNewProduct(
                external_id=external_id,
                name=name,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=category,
                summary=summary or _format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=category,
                ),
                image_url=_build_absolute_url(
                    source.site_url,
                    str(item.get(image_field) or ""),
                ),
                product_url=listing_url,
                published_at=published_at,
                available_from=published_at,
                available_to=available_to,
                is_limited=available_to is not None,
                is_food=True,
                raw_payload={
                    "category_code": category_code,
                    "new_flag": item.get(new_flag_field) if new_flag_field else None,
                    "start_date": item.get(start_date_field) if start_date_field else None,
                    "end_date": item.get(end_date_field) if end_date_field else None,
                },
            )

            existing = products_by_id.get(external_id)
            if not existing:
                products_by_id[external_id] = parsed_product
                continue

            existing_published_at = existing.published_at or ""
            current_published_at = parsed_product.published_at or ""
            if current_published_at > existing_published_at:
                products_by_id[external_id] = parsed_product

    return list(products_by_id.values())


async def _crawl_json_event_feed(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    config = _get_parser_config(source)
    endpoint_url = str(config.get("endpoint_url") or source.crawl_url)
    http_method = str(config.get("http_method") or "POST").upper()
    request_form = dict(config.get("request_form") or {})
    message_payload = config.get("message_payload")
    message_field_name = str(config.get("message_field_name") or "message")
    list_path = str(config.get("list_path") or "")
    id_field = str(config.get("id_field") or "id")
    title_field = str(config.get("title_field") or "title")
    image_field = str(config.get("image_field") or "image")
    fallback_image_field = str(config.get("fallback_image_field") or "")
    start_date_field = str(config.get("start_date_field") or "")
    end_date_field = str(config.get("end_date_field") or "")
    start_date_format = str(config.get("start_date_format") or "")
    end_date_format = str(config.get("end_date_format") or "")
    detail_url_template = str(config.get("detail_url_template") or source.site_url)
    default_category = str(config.get("default_category") or "이벤트")
    summary_fallback = str(config.get("summary_fallback") or "{brand} 공식 이벤트")
    max_items = int(config.get("max_items", 40))
    require_keyword = bool(config.get("require_keyword", True))
    allow_food_names_without_keyword = bool(
        config.get("allow_food_names_without_keyword", False)
    )
    short_name_max_length = int(config.get("short_name_max_length", 16))
    name_hint_keywords = tuple(config.get("name_hint_keywords") or ())
    title_block_keywords = tuple(config.get("title_block_keywords") or ())

    if message_payload is not None:
        request_form[message_field_name] = json.dumps(
            message_payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    response = await client.request(
        http_method,
        endpoint_url,
        data=request_form or None,
        headers={
            **REQUEST_HEADERS,
            "Referer": source.crawl_url,
        },
    )
    response.raise_for_status()
    payload = response.json()
    items = _get_nested_value(payload, list_path)
    if not isinstance(items, list):
        return []

    products: list[ParsedNewProduct] = []
    for item in items[:max_items]:
        external_id = _normalize_text(str(item.get(id_field) or ""))
        title = _normalize_text(str(item.get(title_field) or ""))
        if not external_id or not _passes_title_filters(
            title,
            require_keyword=require_keyword,
            allow_food_names_without_keyword=allow_food_names_without_keyword,
            short_name_max_length=short_name_max_length,
            name_hint_keywords=name_hint_keywords,
            title_block_keywords=title_block_keywords,
        ):
            continue

        published_at = _parse_date_value(str(item.get(start_date_field) or ""), start_date_format)
        available_to = _parse_date_end_value(str(item.get(end_date_field) or ""), end_date_format)
        if not _is_recent_or_active(published_at, available_to):
            continue

        image_value = str(item.get(image_field) or "")
        if not image_value and fallback_image_field:
            image_value = str(item.get(fallback_image_field) or "")
        product_url = _format_template_value(
            detail_url_template,
            external_id=external_id,
            brand=source.brand,
        ) or source.site_url

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=title,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category=default_category,
                summary=_format_template_value(
                    summary_fallback,
                    brand=source.brand,
                    category=default_category,
                ),
                image_url=_build_absolute_url(source.site_url, image_value),
                product_url=product_url,
                published_at=published_at,
                available_from=published_at,
                available_to=available_to,
                is_limited=available_to is not None,
                is_food=True,
                raw_payload={
                    "start_date": item.get(start_date_field) if start_date_field else None,
                    "end_date": item.get(end_date_field) if end_date_field else None,
                },
            )
        )

    return products


async def _crawl_mega_seasonal_menu(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    soup = await _fetch_soup(client, source.crawl_url)
    max_items = int(_get_parser_config(source).get("max_items", 12))
    season_title_element = next(
        (
            element
            for element in soup.select(".cont_title_info")
            if "신메뉴" in element.get_text(" ", strip=True)
        ),
        None,
    )
    if not season_title_element:
        return []

    season_header_item = season_title_element.find_parent("li")
    products_item = season_header_item.find_next_sibling("li") if season_header_item else None
    if not season_header_item or not products_item:
        return []

    season_label = _normalize_text(season_title_element.get_text(" ", strip=True))
    campaign_title = _normalize_text(
        season_header_item.select_one(".cont_title_bg").get_text(" ", strip=True)
        if season_header_item.select_one(".cont_title_bg")
        else ""
    )
    campaign_intro = _normalize_text(
        season_header_item.select_one(".cont_text_title b").get_text(" ", strip=True)
        if season_header_item.select_one(".cont_text_title b")
        else ""
    )

    products: list[ParsedNewProduct] = []
    for slide in products_item.select(".swiper-slide")[:max_items]:
        name_element = slide.select_one(".cont_text_title b")
        summary_element = slide.select_one(".text2")
        image_element = slide.select_one("img")

        name = _normalize_text(name_element.get_text(" ", strip=True) if name_element else "")
        if not name or not _looks_like_food(name):
            continue

        image_url = _build_absolute_url(
            source.site_url,
            image_element.get("src") if image_element else None,
        )
        inferred_uploaded_at = _parse_mega_uploaded_at(image_url)
        external_id = (
            (image_url or "").rstrip("/").rsplit("/", 1)[-1].split("?", 1)[0]
            or f"mega::{name}"
        )

        products.append(
            ParsedNewProduct(
                external_id=external_id,
                name=name,
                brand=source.brand,
                source_type=source.source_type,
                channel=source.channel,
                category="시즌 신메뉴",
                summary=_normalize_text(
                    summary_element.get_text(" ", strip=True) if summary_element else ""
                )
                or f"{season_label} · {campaign_title or source.brand}",
                image_url=image_url,
                product_url="https://www.mega-mgccoffee.com/menu/",
                published_at=None,
                available_from=None,
                available_to=None,
                is_limited=True,
                is_food=True,
                raw_payload={
                    "season_label": season_label,
                    "campaign_title": campaign_title or None,
                    "campaign_intro": campaign_intro or None,
                    "inferred_uploaded_at": inferred_uploaded_at,
                },
            )
        )

    return products


async def _crawl_source(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
) -> list[ParsedNewProduct]:
    if source.parser_type == "emart24_fresh_food":
        return await _crawl_emart24_fresh_food(client, source)
    if source.parser_type == "lotteeatz_launch_events":
        return await _crawl_lotteeatz_launch_events(client, source)
    if source.parser_type == "paikdabang_news_table":
        return await _crawl_paikdabang_news(client, source)
    if source.parser_type == "html_board_news_table":
        return await _crawl_html_board_news_table(client, source)
    if source.parser_type == "html_card_news_grid":
        return await _crawl_html_card_news_grid(client, source)
    if source.parser_type == "html_visual_news_cards":
        return await _crawl_html_visual_news_cards(client, source)
    if source.parser_type == "html_event_card_list":
        return await _crawl_html_event_card_list(client, source)
    if source.parser_type == "html_media_event_list":
        return await _crawl_html_media_event_list(client, source)
    if source.parser_type == "kfc_new_menu":
        return await _crawl_kfc_new_menu(client, source)
    if source.parser_type == "html_paged_new_menu":
        return await _crawl_html_paged_new_menu(client, source)
    if source.parser_type == "html_badge_menu":
        return await _crawl_html_badge_menu(client, source)
    if source.parser_type == "html_linked_menu_cards":
        return await _crawl_html_linked_menu_cards(client, source)
    if source.parser_type == "mcdonalds_promotion":
        return await _crawl_mcdonalds_promotion(client, source)
    if source.parser_type == "json_menu_feed":
        return await _crawl_json_menu_feed(client, source)
    if source.parser_type == "json_event_feed":
        return await _crawl_json_event_feed(client, source)
    if source.parser_type == "mega_seasonal_menu":
        return await _crawl_mega_seasonal_menu(client, source)
    return []


def _build_source_payload(source: NewProductSourceDefinition) -> dict[str, Any]:
    return {
        "source_key": source.source_key,
        "title": source.title,
        "brand": source.brand,
        "source_type": source.source_type,
        "channel": source.channel,
        "site_url": source.site_url,
        "crawl_url": source.crawl_url,
        "parser_type": source.parser_type,
        "parser_config": source.parser_config,
        "source_origin": source.source_origin,
        "discovery_metadata": source.discovery_metadata,
        "is_active": True,
    }


def _deactivate_retired_sources(active_source_keys: set[str], timestamp: str) -> None:
    for source_row in list_new_product_sources():
        source_key = str(source_row.get("source_key") or "").strip()
        source_id = str(source_row.get("id") or "").strip()
        if not source_key or not source_id:
            continue
        if str(source_row.get("source_origin") or "code").strip() != "code":
            continue
        if source_key in active_source_keys:
            continue

        expire_new_products_by_source_id(source_id)
        update_new_product_source(
            source_id,
            {
                "is_active": False,
                "last_crawled_at": timestamp,
            },
        )


def _build_source_definition_from_row(
    source_row: dict[str, Any],
) -> NewProductSourceDefinition | None:
    source_key = str(source_row.get("source_key") or "").strip()
    fallback = SOURCE_DEFINITION_MAP.get(source_key)
    parser_type = str(source_row.get("parser_type") or "").strip()
    parser_config = source_row.get("parser_config")
    source_origin = str(source_row.get("source_origin") or "").strip() or "admin"
    discovery_metadata = source_row.get("discovery_metadata")

    if not parser_type and fallback:
        parser_type = fallback.parser_type
    if not parser_config and fallback:
        parser_config = deepcopy(fallback.parser_config)
    if not discovery_metadata and fallback:
        discovery_metadata = deepcopy(fallback.discovery_metadata)
    if not source_origin and fallback:
        source_origin = fallback.source_origin

    if not source_key or not parser_type:
        return None

    title = str(source_row.get("title") or (fallback.title if fallback else "")).strip()
    brand = str(source_row.get("brand") or (fallback.brand if fallback else "")).strip()
    source_type = str(
        source_row.get("source_type") or (fallback.source_type if fallback else "")
    ).strip()
    channel = str(source_row.get("channel") or (fallback.channel if fallback else "")).strip()
    site_url = str(source_row.get("site_url") or (fallback.site_url if fallback else "")).strip()
    crawl_url = str(
        source_row.get("crawl_url") or (fallback.crawl_url if fallback else "")
    ).strip()

    return NewProductSourceDefinition(
        source_key=source_key,
        title=title,
        brand=brand,
        source_type=source_type,
        channel=channel,
        site_url=site_url,
        crawl_url=crawl_url,
        parser_type=parser_type,
        parser_config=deepcopy(parser_config or {}),
        source_origin=source_origin,
        discovery_metadata=deepcopy(discovery_metadata or {}),
    )


def _sync_code_defined_sources(timestamp: str) -> None:
    active_source_keys = {source.source_key for source in SOURCE_DEFINITIONS}
    _deactivate_retired_sources(active_source_keys, timestamp)
    for source in SOURCE_DEFINITIONS:
        upsert_new_product_source(_build_source_payload(source))


def _load_runtime_sources() -> list[NewProductSourceDefinition]:
    runtime_sources: list[NewProductSourceDefinition] = []
    for source_row in list_runtime_new_product_sources():
        source = _build_source_definition_from_row(source_row)
        if not source:
            logger.warning("Skipping invalid runtime new products source row: %s", source_row)
            continue
        runtime_sources.append(source)
    return runtime_sources


async def _refresh_single_source(
    client: httpx.AsyncClient,
    source: NewProductSourceDefinition,
    *,
    started_at: str,
    trigger: str,
) -> dict[str, Any]:
    source_row = upsert_new_product_source(_build_source_payload(source))
    if not source_row:
        logger.warning(
            "Skipping new products source without persisted row: %s",
            source.source_key,
        )
        return {
            "source_key": source.source_key,
            "title": source.title,
            "fetched": 0,
            "inserted": 0,
            "updated": 0,
            "expired": 0,
            "visible": 0,
            "source_id": None,
        }

    source_id = str(source_row["id"])
    run_row = create_new_product_crawl_run(
        {
            "source_id": source_id,
            "source_key": source.source_key,
            "trigger": trigger,
            "status": "running",
            "started_at": started_at,
        }
    )
    run_id = str(run_row["id"]) if run_row else None

    try:
        existing_rows = get_new_products_by_source_id(source_id)
        existing_lookup = {
            str(row.get("external_id") or ""): row
            for row in existing_rows
            if row.get("external_id")
        }
        existing_ids = set(existing_lookup)
        parsed_products = await _crawl_source(client, source)
        current_external_ids = {product.external_id for product in parsed_products}
        payloads = [
            {
                "source_id": source_id,
                "external_id": product.external_id,
                "name": product.name,
                "brand": product.brand,
                "source_type": product.source_type,
                "channel": product.channel,
                "category": product.category,
                "summary": product.summary,
                "image_url": product.image_url,
                "product_url": product.product_url,
                "published_at": product.published_at,
                "available_from": product.available_from,
                "available_to": product.available_to,
                "last_seen_at": started_at,
                "is_food": product.is_food,
                "is_limited": product.is_limited,
                "status": (
                    "hidden"
                    if existing_lookup.get(product.external_id, {}).get("status") == "hidden"
                    else "visible"
                ),
                "raw_payload": product.raw_payload,
            }
            for product in parsed_products
            if product.is_food
        ]

        expired_product_ids = [
            str(row.get("id"))
            for row in existing_rows
            if row.get("id")
            and row.get("status") == "visible"
            and str(row.get("external_id") or "") not in current_external_ids
        ]

        inserted_count = sum(
            1 for payload in payloads if payload["external_id"] not in existing_ids
        )
        updated_count = max(len(payloads) - inserted_count, 0)
        upsert_new_products(payloads)
        expire_new_products(expired_product_ids)

        finished_at = _utc_now_iso()
        update_new_product_source(
            source_id,
            {
                "is_active": True,
                "last_crawled_at": finished_at,
                "last_success_at": finished_at,
            },
        )
        if run_id:
            update_new_product_crawl_run(
                run_id,
                {
                    "status": "success",
                    "fetched_count": len(parsed_products),
                    "inserted_count": inserted_count,
                    "updated_count": updated_count,
                    "visible_count": len(payloads),
                    "summary": {
                        "title": source.title,
                        "source_type": source.source_type,
                        "expired": len(expired_product_ids),
                    },
                    "finished_at": finished_at,
                },
            )

        return {
            "source_id": source_id,
            "source_key": source.source_key,
            "title": source.title,
            "fetched": len(parsed_products),
            "inserted": inserted_count,
            "updated": updated_count,
            "expired": len(expired_product_ids),
            "visible": len(payloads),
        }
    except Exception as exc:
        finished_at = _utc_now_iso()
        update_new_product_source(source_id, {"last_crawled_at": finished_at})
        if run_id:
            update_new_product_crawl_run(
                run_id,
                {
                    "status": "failed",
                    "error_message": str(exc),
                    "finished_at": finished_at,
                },
            )
        raise


async def preview_new_products_source(
    source: NewProductSourceDefinition,
    *,
    limit: int = 5,
) -> dict[str, Any]:
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        parsed_products = await _crawl_source(client, source)

    preview_items = [
        {
            "external_id": product.external_id,
            "name": product.name,
            "published_at": product.published_at,
            "product_url": product.product_url,
        }
        for product in parsed_products[:limit]
    ]
    return {
        "fetched_products": len(parsed_products),
        "preview_items": preview_items,
    }


async def refresh_new_products_for_source(
    source: NewProductSourceDefinition,
    *,
    trigger: str = "manual",
) -> dict[str, Any]:
    started_at = _utc_now_iso()
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        source_summary = await _refresh_single_source(
            client,
            source,
            started_at=started_at,
            trigger=trigger,
        )

    return {
        "sources": 1,
        "fetched_products": source_summary["fetched"],
        "inserted_products": source_summary["inserted"],
        "updated_products": source_summary["updated"],
        "visible_products": source_summary["visible"],
        "source_summaries": [source_summary],
    }


async def refresh_new_products(trigger: str = "scheduler") -> dict[str, Any]:
    started_at = _utc_now_iso()
    summary: dict[str, Any] = {
        "sources": 0,
        "fetched_products": 0,
        "inserted_products": 0,
        "updated_products": 0,
        "visible_products": 0,
        "source_summaries": [],
    }

    _sync_code_defined_sources(started_at)
    runtime_sources = _load_runtime_sources()

    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for source in runtime_sources:
            source_summary = await _refresh_single_source(
                client,
                source,
                started_at=started_at,
                trigger=trigger,
            )
            summary["sources"] += 1
            summary["fetched_products"] += source_summary["fetched"]
            summary["inserted_products"] += source_summary["inserted"]
            summary["updated_products"] += source_summary["updated"]
            summary["visible_products"] += source_summary["visible"]
            summary["source_summaries"].append(source_summary)

    return summary
