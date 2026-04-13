import { unstable_cache } from "next/cache";

import type { NewProduct, NewProductSource } from "./types";
import type { NewProductSectorFilter, NewProductSectorKey } from "./new-product-taxonomy";
import { createServerSupabaseClient } from "./supabase-server";
import {
  getNewProductBrandLabel,
  getNewProductSectorKey,
  getNewProductSectorLabel,
} from "./new-product-taxonomy";

export type NewProductsPeriod = "1d" | "3d" | "7d" | "30d" | "all";

export interface NewProductBrandOption {
  key: string;
  label: string;
  count: number;
}

export interface NewProductListItem {
  id: string;
  name: string;
  brand: string;
  source_type: NewProduct["source_type"];
  channel: string;
  category: string | null;
  summary: string | null;
  image_url: string | null;
  product_url: string | null;
  published_at: string | null;
  available_from: string | null;
  available_to: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_food: boolean;
  is_limited: boolean;
  status: NewProduct["status"];
  source: NewProductSourceSummary | null;
  effective_at: string;
  filter_at: string | null;
  date_label: "공개일" | "첫 수집";
  brand_label: string;
  sector_key: NewProductSectorKey;
  sector_label: string;
}

export interface NewProductsPageData {
  products: NewProductListItem[];
  sectorCounts: Record<NewProductSectorKey, number>;
  brandOptions: NewProductBrandOption[];
  brandCount: number;
  totalCount: number;
  lastUpdated: string | null;
}

interface NewProductsPageOptions {
  period: NewProductsPeriod;
  sector: NewProductSectorFilter;
  brand: string | null;
}

type NewProductSourceSummary = Pick<
  NewProductSource,
  | "id"
  | "source_key"
  | "title"
  | "brand"
  | "source_type"
  | "channel"
  | "site_url"
  | "discovery_metadata"
>;

type NewProductQueryRow = Pick<
  NewProduct,
  | "id"
  | "name"
  | "brand"
  | "source_type"
  | "channel"
  | "category"
  | "summary"
  | "image_url"
  | "product_url"
  | "published_at"
  | "available_from"
  | "available_to"
  | "first_seen_at"
  | "last_seen_at"
  | "is_food"
  | "is_limited"
  | "status"
> & {
  source?: NewProductSourceSummary | null;
};

const PERIOD_DAYS: Record<Exclude<NewProductsPeriod, "all">, number> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
};

function getFilterDate(
  product: Pick<NewProduct, "published_at" | "available_from">
): string | null {
  return product.published_at || product.available_from || null;
}

function getEffectiveDate(
  product: Pick<NewProduct, "published_at" | "available_from" | "first_seen_at">
) {
  return getFilterDate(product) || product.first_seen_at;
}

function getDateLabel(
  product: Pick<NewProduct, "published_at" | "available_from">
): "공개일" | "첫 수집" {
  return getFilterDate(product) ? "공개일" : "첫 수집";
}

function sortByEffectiveDateDesc(a: NewProductListItem, b: NewProductListItem) {
  return (
    new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime()
  );
}

function createEmptySectorCounts(): Record<NewProductSectorKey, number> {
  return {
    cafe: 0,
    burger: 0,
    pizza: 0,
    sandwich: 0,
    other: 0,
  };
}

function getResolvedBrand(
  product: Pick<NewProduct, "brand"> & {
    source?: Pick<NewProductSource, "brand"> | null;
  }
) {
  return product.source?.brand?.trim() || product.brand.trim();
}

function buildBrandOptions(products: NewProductListItem[]): NewProductBrandOption[] {
  const counts = new Map<string, { label: string; count: number }>();

  products.forEach((product) => {
    const current = counts.get(product.brand);

    if (current) {
      current.count += 1;
      return;
    }

    counts.set(product.brand, {
      label: product.brand_label,
      count: 1,
    });
  });

  return Array.from(counts.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.label.localeCompare(b.label, "ko-KR");
    });
}

const getCachedVisibleNewProducts = unstable_cache(
  async (): Promise<NewProductQueryRow[]> => {
    const supabase = createServerSupabaseClient();

    if (!supabase) {
      return [];
    }

    const { data } = await supabase
      .from("new_products")
      .select(
        [
          "id",
          "name",
          "brand",
          "source_type",
          "channel",
          "category",
          "summary",
          "image_url",
          "product_url",
          "published_at",
          "available_from",
          "available_to",
          "first_seen_at",
          "last_seen_at",
          "is_food",
          "is_limited",
          "status",
          "source:new_product_sources(id, source_key, title, brand, source_type, channel, site_url, discovery_metadata)",
        ].join(", ")
      )
      .eq("status", "visible")
      .eq("is_food", true)
      .order("last_seen_at", { ascending: false })
      .limit(300);

    const rows = Array.isArray(data)
      ? (data as unknown as NewProductQueryRow[])
      : [];

    return rows.filter(
      (product) => product.source_type === "franchise"
    );
  },
  ["visible-new-products"],
  { revalidate: 300 }
);

export async function getNewProductsPageData({
  period,
  sector,
  brand,
}: NewProductsPageOptions): Promise<NewProductsPageData> {
  const rows = await getCachedVisibleNewProducts();

  if (rows.length === 0) {
    return {
      products: [],
      sectorCounts: createEmptySectorCounts(),
      brandOptions: [],
      brandCount: 0,
      totalCount: 0,
      lastUpdated: null,
    };
  }

  const now = Date.now();
  const cutoffMs =
    period === "all" ? null : now - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;

  const mapped = rows
    .map((product) => {
      const resolvedBrand = getResolvedBrand(product);
      const sourceMetadata = product.source?.discovery_metadata;
      const sectorKey = getNewProductSectorKey(resolvedBrand, sourceMetadata);

      return {
        ...product,
        source: product.source ?? null,
        brand: resolvedBrand,
        brand_label: getNewProductBrandLabel(resolvedBrand, sourceMetadata),
        effective_at: getEffectiveDate(product),
        filter_at: getFilterDate(product),
        date_label: getDateLabel(product),
        sector_key: sectorKey,
        sector_label: getNewProductSectorLabel(sectorKey),
      };
    })
    .filter((product) => {
      if (cutoffMs === null) {
        return true;
      }

      if (!product.filter_at) {
        return false;
      }

      return new Date(product.filter_at).getTime() >= cutoffMs;
    });

  const sectorCounts = mapped.reduce((counts, product) => {
    counts[product.sector_key] += 1;
    return counts;
  }, createEmptySectorCounts());

  const filteredBySector =
    sector === "all"
      ? mapped
      : mapped.filter((product) => product.sector_key === sector);

  const brandOptions = sector === "all" ? [] : buildBrandOptions(filteredBySector);
  const selectedBrand =
    sector === "all" || !brand
      ? null
      : brandOptions.some((option) => option.key === brand)
      ? brand
      : null;

  const products = filteredBySector
    .filter((product) => {
      if (!selectedBrand) {
        return true;
      }

      return product.brand === selectedBrand;
    })
    .sort(sortByEffectiveDateDesc);

  const brandCount = new Set(mapped.map((product) => product.brand)).size;

  return {
    products,
    sectorCounts,
    brandOptions,
    brandCount,
    totalCount: products.length,
    lastUpdated: rows[0]?.last_seen_at ?? null,
  };
}
