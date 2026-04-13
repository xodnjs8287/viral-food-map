from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

STARBUCKS_DRINK_CATEGORY_CODES = (
    "W0000171",
    "W0000060",
    "W0000003",
    "W0000004",
    "W0000005",
    "W0000422",
    "W0000061",
    "W0000075",
    "W0000053",
    "W0000062",
)
STARBUCKS_FOOD_CATEGORY_CODES = (
    "W0000013",
    "W0000032",
    "W0000033",
    "W0000054",
    "W0000055",
    "W0000056",
    "W0000064",
    "W0000554",
    "W0000126",
    "W0000074",
    "W0000347",
)


@dataclass(slots=True)
class NewProductSourceDefinition:
    source_key: str
    title: str
    brand: str
    source_type: str
    channel: str
    site_url: str
    crawl_url: str
    parser_type: str
    parser_config: dict[str, Any] = field(default_factory=dict)


# 새 브랜드는 가능한 한 여기만 수정해서 추가한다.
# parser_type은 new_products.py의 핸들러에 매핑되고,
# 같은 템플릿이면 parser_config만 바꿔서 등록할 수 있다.
SOURCE_DEFINITIONS: tuple[NewProductSourceDefinition, ...] = (
    NewProductSourceDefinition(
        source_key="emart24_fresh_food",
        title="이마트24 Fresh Food",
        brand="이마트24",
        source_type="convenience",
        channel="Fresh Food",
        site_url="https://www.emart24.co.kr/goods/ff",
        crawl_url="https://www.emart24.co.kr/goods/ff",
        parser_type="emart24_fresh_food",
        parser_config={
            "max_pages": 3,
        },
    ),
    NewProductSourceDefinition(
        source_key="lotteeatz_launch_events",
        title="LOTTE EATZ 신제품 이벤트",
        brand="LOTTE EATZ",
        source_type="franchise",
        channel="이벤트",
        site_url="https://www.lotteeatz.com/event/main",
        crawl_url="https://www.lotteeatz.com/event/main",
        parser_type="lotteeatz_launch_events",
        parser_config={
            "max_items": 40,
        },
    ),
    NewProductSourceDefinition(
        source_key="paikdabang_news",
        title="빽다방 신메뉴 소식",
        brand="빽다방",
        source_type="franchise",
        channel="소식",
        site_url="https://paikdabang.com/news/",
        crawl_url="https://paikdabang.com/news/",
        parser_type="paikdabang_news_table",
        parser_config={
            "max_items": 40,
        },
    ),
    NewProductSourceDefinition(
        source_key="kfc_new_menu",
        title="KFC 신메뉴",
        brand="KFC",
        source_type="franchise",
        channel="신메뉴",
        site_url="https://www.kfckorea.com/promotion/newMenu",
        crawl_url="https://www.kfckorea.com/promotion/newMenu",
        parser_type="kfc_new_menu",
        parser_config={
            "max_items": 20,
        },
    ),
    NewProductSourceDefinition(
        source_key="momstouch_new_menu",
        title="맘스터치 New 메뉴",
        brand="맘스터치",
        source_type="franchise",
        channel="메뉴",
        site_url="https://www.momstouch.co.kr/menu/new.php?s_sect1=new",
        crawl_url="https://www.momstouch.co.kr/menu/new.php?s_sect1=new",
        parser_type="html_paged_new_menu",
        parser_config={
            "max_pages": 3,
            "item_selector": '.menu-list li a[href*="go_view"]',
            "id_pattern": r"go_view\('?(?P<id>\d+)'?\)",
            "category_selector": ".sub-text",
            "title_selector": "h3",
            "english_name_selector": "h3 span",
            "image_style_selector": "figure span",
            "detail_url_template": "https://www.momstouch.co.kr/menu/view.php?idx={external_id}",
            "default_category": "신제품 메뉴",
            "summary_fallback": "{brand} 공식 신제품 메뉴",
            "published_at_source": "asset_upload_unix",
            "image_timestamp_pattern": r"/(\d{10})-[A-Z0-9]+\.",
        },
    ),
    NewProductSourceDefinition(
        source_key="dominos_new_menu",
        title="도미노피자 NEW 메뉴",
        brand="도미노피자",
        source_type="franchise",
        channel="메뉴",
        site_url="https://web.dominos.co.kr/goods/list?dsp_ctgr=C0101",
        crawl_url="https://web.dominos.co.kr/goods/list?dsp_ctgr=C0101",
        parser_type="html_badge_menu",
        parser_config={
            "scan_limit": 80,
            "item_selector": "div.menu-list ul li",
            "badge_selector": ".label.sale",
            "badge_text": "NEW",
            "detail_link_selector": ".prd-img a[href]",
            "detail_href_strategy": "dominos",
            "external_id_pattern": r"code_01=([A-Z0-9]+)",
            "title_selector": ".subject",
            "hashtag_selector": ".hashtag span",
            "image_selector": "img",
            "image_attr_order": ("data-src", "src"),
            "default_category": "피자",
            "category_heading_tags": ("h3", "h4"),
            "category_exclude_keywords": ("침착맨", "먹어본"),
            "category_max_length": 18,
            "summary_fallback": "{brand} 공식 NEW 메뉴",
            "summary_hashtag_limit": 2,
            "published_at_source": "asset_upload_ymd",
            "image_timestamp_pattern": r"/(\d{8})_[A-Za-z0-9]+\.",
        },
    ),
    NewProductSourceDefinition(
        source_key="mcdonalds_promotion",
        title="맥도날드 프로모션",
        brand="맥도날드",
        source_type="franchise",
        channel="프로모션",
        site_url="https://www.mcdonalds.co.kr/kor/promotion/list",
        crawl_url="https://www.mcdonalds.co.kr/kor/promotion/list",
        parser_type="mcdonalds_promotion",
        parser_config={
            "max_items": 20,
        },
    ),
    NewProductSourceDefinition(
        source_key="starbucks_menu",
        title="스타벅스 신규 메뉴",
        brand="스타벅스",
        source_type="franchise",
        channel="메뉴",
        site_url="https://www.starbucks.co.kr/menu/drink_list.do",
        crawl_url="https://www.starbucks.co.kr/menu/drink_list.do",
        parser_type="json_menu_feed",
        parser_config={
            "category_codes": STARBUCKS_DRINK_CATEGORY_CODES + STARBUCKS_FOOD_CATEGORY_CODES,
            "food_category_codes": STARBUCKS_FOOD_CATEGORY_CODES,
            "endpoint_template": "https://www.starbucks.co.kr/upload/json/menu/{category_code}.js",
            "request_form": {
                "CATE_CD": "{category_code}",
                "SOLD_OUT": "1",
            },
            "response_list_key": "list",
            "id_field": "product_CD",
            "name_field": "product_NM",
            "category_field": "cate_NAME",
            "fallback_category_field": "sell_CAT",
            "summary_field": "content",
            "image_field": "file_PATH",
            "new_flag_field": "newicon",
            "new_flag_value": "Y",
            "start_date_field": "new_SDATE",
            "end_date_field": "new_EDATE",
            "food_listing_url": "https://www.starbucks.co.kr/menu/food_list.do",
            "fallback_category": "신규 메뉴",
            "summary_fallback": "{category} · {brand} 신규 메뉴",
            "start_date_format": "compact",
            "end_date_format": "compact",
            "published_at_source": "explicit",
        },
    ),
    NewProductSourceDefinition(
        source_key="mega_seasonal_menu",
        title="메가MGC 시즌 신메뉴",
        brand="메가MGC커피",
        source_type="franchise",
        channel="메인",
        site_url="https://www.mega-mgccoffee.com/",
        crawl_url="https://www.mega-mgccoffee.com/",
        parser_type="mega_seasonal_menu",
        parser_config={
            "max_items": 12,
        },
    ),
)
