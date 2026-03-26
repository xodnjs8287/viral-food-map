export interface Trend {
  id: string;
  name: string;
  category: string;
  status: "rising" | "active" | "declining" | "inactive";
  detected_at: string;
  peak_score: number;
  search_volume_data: Record<string, number>;
  description: string | null;
  image_url: string | null;
  store_count?: number;
}

export interface Store {
  id: string;
  trend_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  place_url: string | null;
  rating: number | null;
  source: "kakao_api" | "naver_place" | "user_report";
  verified: boolean;
  last_updated: string;
}

export interface Report {
  id?: string;
  trend_id: string;
  store_name: string;
  address: string;
  lat?: number;
  lng?: number;
  note: string | null;
  status?: "pending" | "verified";
  created_at?: string;
}

export interface Keyword {
  id: string;
  keyword: string;
  category: string;
  is_active: boolean;
  last_checked: string | null;
  baseline_volume: number;
}

export interface AnalyticsSummary {
  total_views: number;
  today_views: number;
  unique_visitors: number;
  today_unique: number;
  top_pages: { page_path: string; view_count: number }[] | null;
  trend_views: { trend_id: string; trend_name: string; view_count: number }[] | null;
  hourly_distribution: { hour: number; view_count: number }[] | null;
  daily_views: { date: string; view_count: number; unique_count: number }[] | null;
}

export type LocationStatus =
  | "idle"
  | "loading"
  | "granted"
  | "denied"
  | "unsupported";

export type YomechuCategorySlug =
  | "all"
  | "korean"
  | "chinese"
  | "japanese"
  | "western"
  | "snack"
  | "chicken"
  | "pizza"
  | "asian"
  | "cafe-dessert"
  | "pub";

export type YomechuResultCount = 1 | 2 | 3 | 4 | 5;

export interface YomechuOption<T extends string | number> {
  label: string;
  value: T;
}

export interface YomechuLocationPreset {
  label: string;
  lat: number;
  lng: number;
}

export interface YomechuPlace {
  place_id: string;
  name: string;
  address: string;
  category_label: string;
  distance_m: number;
  rating: number | null;
  trend_names: string[];
  place_url: string;
}

export interface YomechuSpinResponse {
  spin_id: string | null;
  pool_size: number;
  used_fallback: boolean;
  result_count: YomechuResultCount;
  reel: YomechuPlace[];
  winner: YomechuPlace;
  winners: YomechuPlace[];
}
