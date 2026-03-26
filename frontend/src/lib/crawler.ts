import type {
  YomechuCategorySlug,
  YomechuOption,
  YomechuSpinResponse,
} from "./types";

const CRAWLER_BASE_URL =
  process.env.NEXT_PUBLIC_CRAWLER_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

export const YOMECHU_RADIUS_OPTIONS: YomechuOption<number>[] = [
  { label: "500m", value: 500 },
  { label: "1km", value: 1000 },
  { label: "2km", value: 2000 },
  { label: "3km", value: 3000 },
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
