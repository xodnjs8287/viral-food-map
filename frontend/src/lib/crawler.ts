import type {
  YomechuCategorySlug,
  YomechuFeedbackEventType,
  YomechuLocationPreset,
  YomechuOption,
  YomechuResultCount,
  YomechuSpinResponse,
} from "./types";

const DEFAULT_PRODUCTION_CRAWLER_BASE_URL =
  "https://silly-donnamarie-aiproject-41bab04f.koyeb.app";
const YOMECHU_SPIN_TIMEOUT_MS = 12000;

function resolveCrawlerBaseUrl() {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_CRAWLER_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_PRODUCTION_CRAWLER_BASE_URL;

  return configuredBaseUrl.replace(/\/+$/, "");
}

function getCrawlerErrorMessage(detail: unknown, fallback: string) {
  if (Array.isArray(detail)) {
    const resultCountIssue = detail.find(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        Array.isArray((item as { loc?: unknown[] }).loc) &&
        (item as { loc: unknown[] }).loc.includes("result_count")
    );

    if (resultCountIssue) {
      return "현재 서버에서 선택한 추천 수를 아직 반영 중입니다. 잠시 후 다시 시도해 주세요.";
    }

    const joined = detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          typeof item === "object" &&
          item !== null &&
          typeof (item as { msg?: unknown }).msg === "string"
        ) {
          return (item as { msg: string }).msg;
        }

        return null;
      })
      .filter((item): item is string => Boolean(item))
      .join(", ");

    return joined || fallback;
  }

  if (typeof detail === "string") {
    return detail;
  }

  return fallback;
}

async function getCrawlerResponseErrorMessage(
  response: Response,
  fallback: string
) {
  const errorBody = await response.json().catch(() => ({ detail: fallback }));
  return getCrawlerErrorMessage(errorBody.detail, fallback);
}

function getAdminCrawlerHeaders(
  accessToken: string,
  contentType?: string
): Headers {
  if (!accessToken.trim()) {
    throw new Error("관리자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${accessToken}`);

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return headers;
}

const CRAWLER_BASE_URL = resolveCrawlerBaseUrl();

export interface TrendDetectionSummary {
  keywords: number;
  candidates: number;
  confirmed: number;
  stored_trends: number;
  stored_stores: number;
  confirmed_keywords: string[];
  ai_calls_used?: number;
  ai_calls_remaining?: number;
  alias_matches?: number;
  canonicalized_keywords?: string[];
  budget_exhausted?: boolean;
}

export interface TrendDetectionJobStatus {
  state: "idle" | "queued" | "running" | "completed" | "failed";
  last_trigger: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_summary: TrendDetectionSummary | null;
  last_error: string | null;
  running: boolean;
}

export interface TriggerTrendDetectionResponse {
  accepted: boolean;
  status: "queued" | "running";
  message: string;
  job: TrendDetectionJobStatus;
}

export interface CrawlerHealthResponse {
  status: string;
  service: string;
  yomechu_enrich_enabled?: boolean;
  scheduler_timezone?: string;
  daily_ai_limit?: number;
  trend_detection_schedule?: string;
  keyword_discovery_schedule?: string;
  store_update_interval_minutes?: number;
  instagram_posting_enabled?: boolean;
  instagram_feed_schedule?: string;
  instagram_media_bucket?: string;
}

export interface InstagramPublishedTrend {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  peak_score?: number;
}

export interface InstagramFeedRunSnapshot {
  status?: string | null;
  trend_name_snapshot?: string | null;
  skip_reason?: string | null;
}

export interface InstagramPublishSummary {
  run_date: string;
  status: "dry_run" | "noop" | "published" | "skipped";
  reason?: string;
  skip_reason?: string;
  candidate_count?: number;
  published_trend?: InstagramPublishedTrend;
  final_image_url?: string;
  used_fallback_image?: boolean;
  errors?: string[];
  run?: InstagramFeedRunSnapshot | null;
}

export interface PublishInstagramFeedResponse {
  message: string;
  summary: InstagramPublishSummary;
}

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

export function getCrawlerBaseUrl() {
  return CRAWLER_BASE_URL;
}

export async function triggerTrendDetection(
  accessToken: string
): Promise<TriggerTrendDetectionResponse> {
  if (!CRAWLER_BASE_URL) {
    throw new Error("크롤러 API 주소가 설정되지 않았습니다.");
  }

  const response = await fetch(`${CRAWLER_BASE_URL}/api/trends/detect`, {
    method: "POST",
    headers: getAdminCrawlerHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error(
      await getCrawlerResponseErrorMessage(
        response,
        "수동 크롤링 실행에 실패했습니다."
      )
    );
  }

  return response.json();
}

export async function fetchTrendDetectionStatus(): Promise<TrendDetectionJobStatus> {
  if (!CRAWLER_BASE_URL) {
    throw new Error("크롤러 API 주소가 설정되지 않았습니다.");
  }

  const response = await fetch(`${CRAWLER_BASE_URL}/api/trends/detect/status`);

  if (!response.ok) {
    throw new Error("크롤링 상태 확인에 실패했습니다.");
  }

  return response.json();
}

export async function publishInstagramFeed(
  accessToken: string,
  options: {
    dryRun?: boolean;
    forceRetry?: boolean;
  } = {}
): Promise<PublishInstagramFeedResponse> {
  if (!CRAWLER_BASE_URL) {
    throw new Error("크롤러 API 주소가 설정되지 않았습니다.");
  }

  const response = await fetch(`${CRAWLER_BASE_URL}/api/instagram/feed/publish`, {
    method: "POST",
    headers: getAdminCrawlerHeaders(accessToken, "application/json"),
    body: JSON.stringify({
      dry_run: options.dryRun ?? false,
      force_retry: options.forceRetry ?? false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await getCrawlerResponseErrorMessage(
        response,
        "인스타그램 게시 실행에 실패했습니다."
      )
    );
  }

  return response.json();
}

export async function fetchCrawlerHealth(): Promise<CrawlerHealthResponse> {
  if (!CRAWLER_BASE_URL) {
    throw new Error("크롤러 API 주소가 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);

  let response: Response;

  try {
    response = await fetch(`${CRAWLER_BASE_URL}/health`, {
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("크롤러 상태 확인이 지연되고 있습니다.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error("크롤러 상태 확인에 실패했습니다.");
  }

  return response.json();
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

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    YOMECHU_SPIN_TIMEOUT_MS
  );

  let response: Response;

  try {
    response = await fetch(`${CRAWLER_BASE_URL}/api/yomechu/spin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "요메추 추천이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const fallbackMessage = "요메추 추천을 불러오지 못했습니다.";
    throw new Error(
      await getCrawlerResponseErrorMessage(response, fallbackMessage)
    );
  }

  return response.json();
}

export async function sendYomechuFeedback(payload: {
  spin_id: string;
  place_id?: string | null;
  session_id?: string | null;
  event_type: YomechuFeedbackEventType;
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
