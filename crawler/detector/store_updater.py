import logging
import uuid
from collections import defaultdict
from datetime import datetime

from crawlers.store_finder import find_stores_nationwide
from database import get_active_trends, get_stores_by_trend_ids, insert_stores

logger = logging.getLogger(__name__)


def _store_key(name: str, address: str) -> tuple[str, str]:
    return (name.strip(), address.strip())


def build_store_records(
    trend_id: str,
    stores: list[dict],
    existing_keys: set[tuple[str, str]] | None = None,
) -> list[dict]:
    known_keys = existing_keys if existing_keys is not None else set()
    generated_keys = set()
    collected_at = datetime.now().isoformat()
    records = []

    for store in stores:
        key = _store_key(store["name"], store["address"])
        if key in known_keys or key in generated_keys:
            continue

        generated_keys.add(key)
        known_keys.add(key)
        records.append({
            **store,
            "id": str(uuid.uuid4()),
            "trend_id": trend_id,
            "last_updated": collected_at,
        })

    return records


async def refresh_stores_for_active_trends() -> dict:
    logger.info("=== 판매처 갱신 시작 ===")

    trends = get_active_trends() or []
    summary = {
        "target_trends": len(trends),
        "processed_trends": 0,
        "added_stores": 0,
        "changed_trends": [],
    }

    if not trends:
        logger.info("판매처 갱신 대상 트렌드 없음")
        return summary

    trend_ids = [trend["id"] for trend in trends if trend.get("id")]
    existing_stores = get_stores_by_trend_ids(trend_ids) or []
    existing_keys_by_trend: dict[str, set[tuple[str, str]]] = defaultdict(set)

    for store in existing_stores:
        existing_keys_by_trend[store["trend_id"]].add(
            _store_key(store["name"], store["address"])
        )

    for trend in trends:
        trend_id = trend.get("id")
        keyword = trend.get("name")
        if not trend_id or not keyword:
            continue

        summary["processed_trends"] += 1
        stores = await find_stores_nationwide(keyword)
        new_records = build_store_records(
            trend_id=trend_id,
            stores=stores,
            existing_keys=existing_keys_by_trend[trend_id],
        )

        if not new_records:
            logger.info(f"'{keyword}' 신규 판매처 없음")
            continue

        insert_stores(new_records)
        summary["added_stores"] += len(new_records)
        summary["changed_trends"].append(keyword)
        logger.info(f"'{keyword}' 신규 판매처 {len(new_records)}개 추가")

    logger.info(
        f"=== 판매처 갱신 완료: {summary['processed_trends']}개 트렌드, "
        f"{summary['added_stores']}개 추가 ==="
    )
    return summary
