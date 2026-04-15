import { cache } from "react";

import { createServerSupabaseClient } from "./supabase-server";

const WIDGET_RANKING_LIMIT = 10;

type WidgetTrendRow = {
  id: string;
  name: string;
  peak_score: number;
  previous_rank: number | null;
  stores?: { count: number }[] | null;
};

export interface WidgetRankingItem {
  id: string;
  name: string;
  peak_score: number;
  previous_rank: number | null;
  current_rank: number;
  store_count: number;
}

export interface WidgetRankingsPayload {
  generated_at: string;
  items: WidgetRankingItem[];
}

export const getWidgetRankings = cache(
  async (
    limit = WIDGET_RANKING_LIMIT
  ): Promise<WidgetRankingsPayload> => {
    const supabase = createServerSupabaseClient(300);
    const generatedAt = new Date().toISOString();

    if (!supabase) {
      return {
        generated_at: generatedAt,
        items: [],
      };
    }

    const { data } = await supabase
      .from("trends")
      .select("id, name, peak_score, previous_rank, stores(count)")
      .in("status", ["rising", "active", "declining"])
      .order("peak_score", { ascending: false })
      .order("id", { ascending: true })
      .limit(limit);

    const items = ((data as WidgetTrendRow[] | null) ?? []).map(
      (item, index) => ({
        id: item.id,
        name: item.name,
        peak_score: item.peak_score,
        previous_rank: item.previous_rank,
        current_rank: index + 1,
        store_count: item.stores?.[0]?.count ?? 0,
      })
    );

    return {
      generated_at: generatedAt,
      items,
    };
  }
);
