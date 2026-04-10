import httpx
import re
import random
import logging

from notifications import send_discord_message

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]


async def get_hashtag_post_count(hashtag: str) -> int | None:
    """인스타그램 해시태그 게시물 수 조회 (비공식)"""
    url = f"https://www.instagram.com/explore/tags/{hashtag}/"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, headers=headers, timeout=15)

            if resp.status_code != 200:
                logger.warning(f"인스타그램 접근 차단 (status={resp.status_code})")
                await send_discord_message(f"[⚠️ 인스타그램] 접근 차단 (status={resp.status_code})")
                return None

            # meta 태그에서 게시물 수 추출
            match = re.search(r'"edge_hashtag_to_media":\{"count":(\d+)', resp.text)
            if match:
                return int(match.group(1))

            # 대안: og:description에서 추출
            match = re.search(r'content="([\d,]+) Posts', resp.text)
            if match:
                return int(match.group(1).replace(",", ""))

            match = re.search(r'게시물 ([\d,]+)개', resp.text)
            if match:
                return int(match.group(1).replace(",", ""))

    except Exception as e:
        logger.error(f"인스타그램 크롤링 오류 ({hashtag}): {e}")

    return None
