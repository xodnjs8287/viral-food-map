import type { NewProductsPeriod } from "@/lib/new-products-server";
import {
  NEW_PRODUCT_SECTOR_OPTIONS,
  getNewProductSectorLabel,
  type NewProductSectorFilter,
} from "@/lib/new-product-taxonomy";

export const PERIOD_OPTIONS: Array<{ key: NewProductsPeriod; label: string }> = [
  { key: "1d", label: "오늘" },
  { key: "3d", label: "3일" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "all", label: "전체" },
];

export const SECTOR_OPTIONS = NEW_PRODUCT_SECTOR_OPTIONS;

export function normalizePeriod(period?: string): NewProductsPeriod {
  return PERIOD_OPTIONS.some((option) => option.key === period)
    ? (period as NewProductsPeriod)
    : "30d";
}

export function normalizeSector(sector?: string): NewProductSectorFilter {
  return SECTOR_OPTIONS.some((option) => option.key === sector)
    ? (sector as NewProductSectorFilter)
    : "all";
}

export function normalizeBrand(brand?: string) {
  const trimmed = brand?.trim();
  return trimmed ? trimmed : null;
}

export function buildFilterHref(
  period: NewProductsPeriod,
  sector: NewProductSectorFilter,
  brand?: string | null
) {
  const params = new URLSearchParams();

  if (period !== "30d") {
    params.set("period", period);
  }

  if (sector !== "all") {
    params.set("sector", sector);
  }

  if (sector !== "all" && brand) {
    params.set("brand", brand);
  }

  const query = params.toString();
  return query ? `/new?${query}` : "/new";
}

export function getPeriodLabel(period: NewProductsPeriod) {
  return PERIOD_OPTIONS.find((option) => option.key === period)?.label ?? "30일";
}

export function getSectorLabel(sector: NewProductSectorFilter) {
  return getNewProductSectorLabel(sector);
}
