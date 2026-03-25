"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Store, Trend } from "@/lib/types";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import KakaoMap from "@/components/KakaoMap";
import StoreList from "@/components/StoreList";

export default function MapPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [selectedTrendId, setSelectedTrendId] = useState<string | "all">("all");
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number }>({
    lat: 37.5665,
    lng: 126.978,
  });

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }

    supabase
      .from("trends")
      .select("id, name, category, status")
      .in("status", ["rising", "active"])
      .then(({ data }) => {
        if (data) setTrends(data as Trend[]);
      });

    supabase
      .from("stores")
      .select("*, trends(name)")
      .then(({ data }) => {
        if (data) setStores(data.map((s: any) => ({ ...s, trend_name: s.trends?.name })) as any);
      });
  }, []);

  const filteredStores =
    selectedTrendId === "all"
      ? stores
      : stores.filter((s) => s.trend_id === selectedTrendId);

  const trendMap = new Map(trends.map((t) => [t.id, t.name]));

  return (
    <>
      <Header />
      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1 pr-4 scrollbar-hide">
          <button
            onClick={() => setSelectedTrendId("all")}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedTrendId === "all"
                ? "bg-primary text-white"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            전체
          </button>
          {trends.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTrendId(t.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedTrendId === t.id
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <KakaoMap
          stores={filteredStores}
          center={userLoc}
          level={7}
          className="map-container !h-[60vh]"
          selectedStoreId={selectedStoreId}
          onMarkerClick={setSelectedStoreId}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-gray-900">
              판매처 {filteredStores.length}곳
            </h3>
          </div>
          <div className="space-y-2">
            {filteredStores.map((store) => (
              <div
                key={store.id}
                id={`store-${store.id}`}
                onClick={() => setSelectedStoreId(store.id)}
                className={`bg-white rounded-xl p-3 border flex items-center gap-3 transition-all cursor-pointer ${
                  store.id === selectedStoreId
                    ? "ring-2 ring-purple-400 border-purple-300"
                    : "border-gray-100"
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-lg flex-shrink-0">
                  {store.verified ? "✅" : "📍"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-semibold text-sm text-gray-900 truncate">
                      {store.name}
                    </h4>
                    {selectedTrendId === "all" && (store as any).trend_name && (
                      <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {(store as any).trend_name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{store.address}</p>
                </div>
                <a
                  href={store.place_url || `https://m.place.naver.com/search/${encodeURIComponent(store.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-shrink-0 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-green-600 transition-colors"
                >
                  네이버
                </a>
              </div>
            ))}
          </div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
