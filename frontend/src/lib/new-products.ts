import type {
  NewProductSectorFilter,
  NewProductSectorKey,
} from "./new-product-taxonomy";

export type NewProductsPeriod = "1d" | "3d" | "7d" | "30d" | "all";

export interface NewProductBrandOption {
  key: string;
  label: string;
  count: number;
}

export interface NewProductDisplaySource {
  title: string;
  site_url: string | null;
}

export interface NewProductDisplayItem {
  id: string;
  name: string;
  brand: string;
  channel: string;
  category: string | null;
  summary: string | null;
  image_url: string | null;
  product_url: string | null;
  is_limited: boolean;
  source: NewProductDisplaySource | null;
  effective_at: string;
  filter_at: string | null;
  date_label: "공개일" | "첫 수집";
  brand_label: string;
  sector_key: NewProductSectorKey;
  sector_label: string;
}

export type NewProductListItem = NewProductDisplayItem;

export interface NewProductsViewData {
  products: NewProductDisplayItem[];
  sectorCounts: Record<NewProductSectorKey, number>;
  brandOptions: NewProductBrandOption[];
  brandCount: number;
  totalCount: number;
  selectedBrand: string | null;
}

interface DeriveNewProductsViewOptions {
  period: NewProductsPeriod;
  sector: NewProductSectorFilter;
  brand: string | null;
}

const PERIOD_DAYS: Record<Exclude<NewProductsPeriod, "all">, number> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
};

function sortByEffectiveDateDesc(a: NewProductDisplayItem, b: NewProductDisplayItem) {
  return new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime();
}

export function createEmptySectorCounts(): Record<NewProductSectorKey, number> {
  return {
    cafe: 0,
    burger: 0,
    pizza: 0,
    sandwich: 0,
    other: 0,
  };
}

function buildBrandOptions(products: NewProductDisplayItem[]): NewProductBrandOption[] {
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

export function deriveNewProductsView(
  products: NewProductDisplayItem[],
  { period, sector, brand }: DeriveNewProductsViewOptions
): NewProductsViewData {
  const now = Date.now();
  const cutoffMs =
    period === "all" ? null : now - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;

  const filteredByPeriod = products.filter((product) => {
    if (cutoffMs === null) {
      return true;
    }

    if (!product.filter_at) {
      return false;
    }

    return new Date(product.filter_at).getTime() >= cutoffMs;
  });

  const sectorCounts = filteredByPeriod.reduce((counts, product) => {
    counts[product.sector_key] += 1;
    return counts;
  }, createEmptySectorCounts());

  const filteredBySector =
    sector === "all"
      ? filteredByPeriod
      : filteredByPeriod.filter((product) => product.sector_key === sector);

  const brandOptions = sector === "all" ? [] : buildBrandOptions(filteredBySector);
  const selectedBrand =
    sector === "all" || !brand
      ? null
      : brandOptions.some((option) => option.key === brand)
        ? brand
        : null;

  const filteredProducts = filteredBySector
    .filter((product) => {
      if (!selectedBrand) {
        return true;
      }

      return product.brand === selectedBrand;
    })
    .sort(sortByEffectiveDateDesc);

  return {
    products: filteredProducts,
    sectorCounts,
    brandOptions,
    brandCount: new Set(filteredByPeriod.map((product) => product.brand)).size,
    totalCount: filteredProducts.length,
    selectedBrand,
  };
}
