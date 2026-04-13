import { cache } from "react";
import type { Store, Trend } from "./types";
import { createServerSupabaseClient } from "./supabase-server";

type TrendWithStoreCount = Trend & {
  store_count: number;
  stores?: { count: number }[] | null;
};

export interface HomePageData {
  trends: TrendWithStoreCount[];
  verifiedStoreCount: number;
  lastUpdated: string | null;
}

export interface TrendDetailData {
  trend: TrendWithStoreCount;
  stores: Store[];
}

export const getActiveTrends = cache(async (): Promise<TrendWithStoreCount[]> => {
  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return [];
  }

  const { data } = await supabase
    .from("trends")
    .select("*, stores(count)")
    .in("status", ["rising", "active", "declining"])
    .order("peak_score", { ascending: false })
    .order("id", { ascending: true });

  return (
    data?.map((trend: any) => ({
      ...trend,
      store_count: trend.stores?.[0]?.count ?? 0,
    })) ?? []
  ) as TrendWithStoreCount[];
});

export const getHomePageData = cache(async (): Promise<HomePageData> => {
  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return {
      trends: [],
      verifiedStoreCount: 0,
      lastUpdated: null,
    };
  }

  const [trends, verifiedStoresResult] = await Promise.all([
    getActiveTrends(),
    supabase
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("verified", true),
  ]);

  return {
    trends,
    verifiedStoreCount: verifiedStoresResult.count ?? 0,
    lastUpdated: trends[0]?.detected_at ?? null,
  };
});

export const getTrendDetailById = cache(
  async (id: string): Promise<TrendDetailData | null> => {
    const supabase = createServerSupabaseClient();

    if (!supabase) {
      return null;
    }

    const [trendResult, storesResult] = await Promise.all([
      supabase.from("trends").select("*, stores(count)").eq("id", id).single(),
      supabase
        .from("stores")
        .select("*")
        .eq("trend_id", id)
        .order("verified", { ascending: false }),
    ]);

    if (!trendResult.data) {
      return null;
    }

    const trend = trendResult.data as TrendWithStoreCount;

    return {
      trend: {
        ...trend,
        store_count: trend.stores?.[0]?.count ?? 0,
      },
      stores: (storesResult.data as Store[]) ?? [],
    };
  }
);

export const getTrendsForSitemap = cache(
  async (): Promise<Array<Pick<Trend, "id" | "detected_at">>> => {
    const supabase = createServerSupabaseClient();

    if (!supabase) {
      return [];
    }

    const { data } = await supabase
      .from("trends")
      .select("id, detected_at")
      .order("detected_at", { ascending: false });

    return (data as Array<Pick<Trend, "id" | "detected_at">>) ?? [];
  }
);
