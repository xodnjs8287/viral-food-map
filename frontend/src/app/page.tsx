"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Trend, Store } from "@/lib/types";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import TrendCard from "@/components/TrendCard";
import InstallPrompt from "@/components/InstallPrompt";
import Link from "next/link";

function getDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface NearbyStore extends Store {
  distance: number;
  trend_name?: string;
}

export default function Home() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null
  );

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  useEffect(() => {
    const fetchTrends = async () => {
      const { data } = await supabase
        .from("trends")
        .select("*, stores(count)")
        .in("status", ["rising", "active"])
        .order("peak_score", { ascending: false });

      if (data) {
        const mapped = data.map((t: any) => ({
          ...t,
          store_count: t.stores?.[0]?.count || 0,
        }));
        setTrends(mapped);
      }
      setLoading(false);
    };

    fetchTrends();

    const channel = supabase
      .channel("trends-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trends" },
        () => fetchTrends()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!userLoc) return;

    const fetchNearby = async () => {
      const { data: stores } = await supabase
        .from("stores")
        .select("*, trends(name)");

      if (stores) {
        const withDistance = stores
          .map((s: any) => ({
            ...s,
            trend_name: s.trends?.name,
            distance: getDistance(userLoc.lat, userLoc.lng, s.lat, s.lng),
          }))
          .sort((a: NearbyStore, b: NearbyStore) => a.distance - b.distance)
          .slice(0, 5);
        setNearbyStores(withDistance);
      }
    };

    fetchNearby();
  }, [userLoc]);

  return (
    <>
      <Header />
      <main className="max-w-lg mx-auto px-4 py-4">
        <section className="mb-6">
          <div className="bg-gradient-to-br from-purple-400 to-blue-400 rounded-2xl p-5 text-white">
            <h2 className="text-lg font-extrabold mb-1">요즘 뭐 먹어? 🔥</h2>
            <p className="text-sm opacity-90">
              SNS에서 바이럴 중인 음식과 판매처를 실시간으로 알려드려요
            </p>
          </div>
        </section>

        <InstallPrompt />

        {nearbyStores.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">📍 내 근처 판매처</h3>
              <Link href="/map" className="text-xs text-primary font-medium">
                지도에서 보기
              </Link>
            </div>
            <div className="space-y-2">
              {nearbyStores.map((store) => (
                <div
                  key={store.id}
                  className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-lg flex-shrink-0">
                    📍
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm text-gray-900 truncate">
                        {store.name}
                      </h4>
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {store.trend_name}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">
                      {store.address}
                    </p>
                  </div>
                  <span className="text-xs text-primary font-semibold flex-shrink-0">
                    {store.distance < 1
                      ? `${Math.round(store.distance * 1000)}m`
                      : `${store.distance.toFixed(1)}km`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900">트렌드 목록</h3>
            <span className="text-xs text-gray-400">
              {trends.length}개 트렌드
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-8">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-4 animate-pulse h-24"
                />
              ))}
            </div>
          ) : trends.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">🔍</p>
              <p className="font-medium">아직 감지된 트렌드가 없어요</p>
              <p className="text-sm mt-1">크롤러가 열심히 찾는 중...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {trends.map((trend) => (
                <TrendCard key={trend.id} trend={trend} />
              ))}
            </div>
          )}
        </section>
      </main>
      <BottomNav />
    </>
  );
}
