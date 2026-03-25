"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Trend, Store } from "@/lib/types";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import KakaoMap from "@/components/KakaoMap";
import StoreList from "@/components/StoreList";
import TrendBadge from "@/components/TrendBadge";
import Link from "next/link";

export default function TrendDetailPage() {
  const { id } = useParams();
  const [trend, setTrend] = useState<Trend | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      const [trendRes, storesRes] = await Promise.all([
        supabase.from("trends").select("*").eq("id", id).single(),
        supabase
          .from("stores")
          .select("*")
          .eq("trend_id", id)
          .order("verified", { ascending: false }),
      ]);

      if (trendRes.data) setTrend(trendRes.data as Trend);
      if (storesRes.data) setStores(storesRes.data as Store[]);
      setLoading(false);
    };

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <>
        <Header showBack />
        <main className="max-w-lg mx-auto px-4 py-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/2" />
            <div className="h-64 bg-gray-200 rounded-2xl" />
            <div className="h-20 bg-gray-200 rounded-xl" />
          </div>
        </main>
        <BottomNav />
      </>
    );
  }

  if (!trend) {
    return (
      <>
        <Header showBack />
        <main className="max-w-lg mx-auto px-4 py-12 text-center text-gray-400">
          <p className="text-4xl mb-3">😅</p>
          <p>트렌드를 찾을 수 없어요</p>
        </main>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      <Header showBack />
      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-gray-900">{trend.name}</h2>
            <TrendBadge status={trend.status} />
          </div>
          {trend.description && (
            <p className="text-sm text-gray-500">{trend.description}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {trend.detected_at &&
              `${new Date(trend.detected_at).toLocaleDateString("ko-KR")} 감지`}{" "}
            · 판매처 {stores.length}곳
          </p>
        </div>

        <KakaoMap
          stores={stores}
          selectedStoreId={selectedStoreId}
          onMarkerClick={setSelectedStoreId}
        />

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900">판매처 목록</h3>
            <Link
              href={`/report?trend=${id}`}
              className="text-xs text-primary font-medium"
            >
              + 제보하기
            </Link>
          </div>
          <StoreList
            stores={stores}
            selectedStoreId={selectedStoreId}
            onStoreClick={setSelectedStoreId}
          />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
