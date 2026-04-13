import type {
  NewProductsPeriod,
  NewProductsSourceFilter,
} from "@/lib/new-products-server";

export const PERIOD_OPTIONS: Array<{ key: NewProductsPeriod; label: string }> = [
  { key: "1d", label: "오늘" },
  { key: "3d", label: "3일" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "all", label: "전체" },
];

export const SOURCE_OPTIONS: Array<{
  key: NewProductsSourceFilter;
  label: string;
}> = [
  { key: "all", label: "전체" },
  { key: "convenience", label: "편의점" },
  { key: "franchise", label: "프랜차이즈" },
];

export function normalizePeriod(period?: string): NewProductsPeriod {
  return PERIOD_OPTIONS.some((option) => option.key === period)
    ? (period as NewProductsPeriod)
    : "30d";
}

export function normalizeSource(source?: string): NewProductsSourceFilter {
  return SOURCE_OPTIONS.some((option) => option.key === source)
    ? (source as NewProductsSourceFilter)
    : "all";
}

export function buildFilterHref(
  period: NewProductsPeriod,
  source: NewProductsSourceFilter
) {
  const params = new URLSearchParams();

  if (period !== "30d") {
    params.set("period", period);
  }

  if (source !== "all") {
    params.set("source", source);
  }

  const query = params.toString();
  return query ? `/new?${query}` : "/new";
}

export function getPeriodLabel(period: NewProductsPeriod) {
  return PERIOD_OPTIONS.find((option) => option.key === period)?.label ?? "30일";
}

export function getSourceLabel(source: NewProductsSourceFilter) {
  return SOURCE_OPTIONS.find((option) => option.key === source)?.label ?? "전체";
}
