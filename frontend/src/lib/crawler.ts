import type {
  YomechuCategorySlug,
  YomechuLocationPreset,
  YomechuOption,
  YomechuResultCount,
  YomechuSpinResponse,
} from "./types";

const DEFAULT_PRODUCTION_CRAWLER_BASE_URL =
  "https://silly-donnamarie-aiproject-41bab04f.koyeb.app";

function resolveCrawlerBaseUrl() {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_CRAWLER_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_PRODUCTION_CRAWLER_BASE_URL;

  return configuredBaseUrl.replace(/\/+$/, "");
}

const CRAWLER_BASE_URL = resolveCrawlerBaseUrl();

export const YOMECHU_RADIUS_OPTIONS: YomechuOption<number>[] = [
  { label: "500m", value: 500 },
  { label: "1km", value: 1000 },
  { label: "2km", value: 2000 },
  { label: "3km", value: 3000 },
];

export const YOMECHU_COUNT_OPTIONS: YomechuOption<YomechuResultCount>[] = [
  { label: "1곳", value: 1 },
  { label: "2곳", value: 2 },
  { label: "3곳", value: 3 },
  { label: "4곳", value: 4 },
  { label: "5곳", value: 5 },
];

export const YOMECHU_LOCATION_PRESETS: YomechuLocationPreset[] = [
  { label: "서울시청", lat: 37.5665, lng: 126.978 },
  { label: "강남역", lat: 37.4979, lng: 127.0276 },
  { label: "홍대입구", lat: 37.5572, lng: 126.9245 },
  { label: "잠실역", lat: 37.5133, lng: 127.1001 },
  { label: "성수역", lat: 37.5446, lng: 127.0557 },
];

export const YOMECHU_CATEGORY_OPTIONS: YomechuOption<YomechuCategorySlug>[] = [
  { label: "전체", value: "all" },
  { label: "한식", value: "korean" },
  { label: "중식", value: "chinese" },
  { label: "일식", value: "japanese" },
  { label: "양식", value: "western" },
  { label: "분식", value: "snack" },
  { label: "치킨", value: "chicken" },
  { label: "피자", value: "pizza" },
  { label: "아시안", value: "asian" },
  { label: "카페/디저트", value: "cafe-dessert" },
  { label: "주점", value: "pub" },
];

export function formatDistanceMeters(distanceM: number) {
  if (distanceM < 1000) {
    return `${distanceM}m`;
  }

  return `${(distanceM / 1000).toFixed(1)}km`;
}

export async function fetchYomechuSpin(payload: {
  lat: number;
  lng: number;
  radius_m: number;
  category_slug: YomechuCategorySlug;
  result_count: YomechuResultCount;
  session_id: string;
}): Promise<YomechuSpinResponse> {
  if (!CRAWLER_BASE_URL) {
    throw new Error("크롤러 API 주소가 설정되지 않았습니다.");
  }

  const response = await fetch(`${CRAWLER_BASE_URL}/api/yomechu/spin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response
      .json()
      .catch(() => ({ detail: "요메추 추천을 가져오지 못했습니다." }));
    throw new Error(errorBody.detail || "요메추 추천을 가져오지 못했습니다.");
  }

  return response.json();
}

export async function sendYomechuFeedback(payload: {
  spin_id: string;
  place_id?: string | null;
  session_id: string;
  event_type: "reroll" | "open" | "close";
  payload?: Record<string, unknown>;
}) {
  if (!CRAWLER_BASE_URL) {
    return;
  }

  try {
    await fetch(`${CRAWLER_BASE_URL}/api/yomechu/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Fire-and-forget analytics; UI should not block on this.
  }
}
