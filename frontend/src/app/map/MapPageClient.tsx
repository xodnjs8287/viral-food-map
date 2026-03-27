"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import KakaoMap, { type MapBounds } from "@/components/KakaoMap";
import { openExternalUrl, openInstagramTag } from "@/lib/external-links";
import { supabase } from "@/lib/supabase";
import type { Store, Trend } from "@/lib/types";

interface MapPageClientProps {
  initialTrends: Trend[];
}

type MapStore = Store & {
  trend_name?: string | null;
};

export default function MapPageClient({ initialTrends }: MapPageClientProps) {
  const [trends, setTrends] = useState<Trend[]>(initialTrends);
  const [stores, setStores] = useState<MapStore[]>([]);
  const [selectedTrendId, setSelectedTrendId] = useState<string | "all">("all");
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [storeQuery, setStoreQuery] = useState("");
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locReady, setLocReady] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setUserLoc({ lat: 37.5665, lng: 126.978 });
      setLocationMessage("위치 기능을 지원하지 않아 서울 시청 기준으로 표시 중입니다.");
      setLocReady(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationMessage(null);
        setLocReady(true);
      },
      () => {
        setUserLoc({ lat: 37.5665, lng: 126.978 });
        setLocationMessage("위치 권한이 없어 서울 시청 기준으로 표시 중입니다.");
        setLocReady(true);
      },
      { timeout: 5000 }
    );
  }, []);

  const fetchTrends = useCallback(async () => {
    const { data } = await supabase
      .from("trends")
      .select("*")
      .in("status", ["rising", "active"])
      .order("peak_score", { ascending: false });

    if (data) {
      setTrends(data as Trend[]);
    }
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  useEffect(() => {
    void fetchTrends();
  }, [fetchTrends]);

  useEffect(() => {
    if (!mapBounds) return;

    let query = supabase
      .from("stores")
      .select(
        "id, name, address, lat, lng, phone, place_url, rating, verified, trend_id, trends(name)"
      )
      .gte("lat", mapBounds.sw.lat)
      .lte("lat", mapBounds.ne.lat)
      .gte("lng", mapBounds.sw.lng)
      .lte("lng", mapBounds.ne.lng)
      .limit(300);

    if (selectedTrendId !== "all") {
      query = query.eq("trend_id", selectedTrendId);
    }

    query.then(({ data }) => {
      if (data) {
        setStores(
          data.map((store: any) => ({
            ...store,
            trend_name: store.trends?.name,
          })) as MapStore[]
        );
      }
    });
  }, [mapBounds, selectedTrendId]);

  const filteredStores = useMemo(() => {
    if (!storeQuery.trim()) return stores;
    const q = storeQuery.trim().toLowerCase();
    return stores.filter(
      (store) =>
        store.name.toLowerCase().includes(q) ||
        store.address.toLowerCase().includes(q)
    );
  }, [stores, storeQuery]);

  useEffect(() => {
    if (!selectedStoreId) return;
    if (filteredStores.some((store) => store.id === selectedStoreId)) return;
    setSelectedStoreId(null);
  }, [filteredStores, selectedStoreId]);

  const hasStoreQuery = storeQuery.trim().length > 0;
  const showSearchInput = stores.length > 3 || hasStoreQuery;

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
          {trends.map((trend) => (
            <button
              key={trend.id}
              onClick={() => setSelectedTrendId(trend.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedTrendId === trend.id
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {trend.name}
            </button>
          ))}
        </div>

        {locationMessage && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">
              {locationMessage}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              브라우저 위치 권한을 허용하면 내 주변 판매처 기준으로 다시 보여드립니다.
            </p>
            <button
              onClick={requestLocation}
              className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-950"
            >
              현재 위치 다시 시도
            </button>
          </div>
        )}

        {locReady && userLoc ? (
          <KakaoMap
            stores={filteredStores}
            center={userLoc}
            level={7}
            className="map-container !h-[60vh]"
            selectedStoreId={selectedStoreId}
            onMarkerClick={setSelectedStoreId}
            onBoundsChange={setMapBounds}
            autoFitBounds={false}
          />
        ) : (
          <div className="map-container !h-[60vh] bg-gray-100 flex items-center justify-center rounded-xl">
            <p className="text-gray-400 text-sm">위치 확인 중...</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-gray-900">
              {`판매처 ${filteredStores.length}곳`}
            </h3>
          </div>
          {showSearchInput && (
            <div className="mb-3">
              <input
                type="text"
                value={storeQuery}
                onChange={(e) => setStoreQuery(e.target.value)}
                placeholder="판매처 이름이나 주소 검색"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
          {filteredStores.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
              <p className="text-sm font-semibold text-gray-700">
                {hasStoreQuery && stores.length > 0
                  ? "검색 결과와 일치하는 판매처가 없습니다."
                  : "현재 지도 범위에 판매처가 없습니다."}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {hasStoreQuery && stores.length > 0
                  ? "다른 이름이나 주소로 다시 검색해 보세요."
                  : "지도를 이동하거나 다른 트렌드를 선택해 보세요."}
              </p>
            </div>
          ) : (
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
                      {selectedTrendId === "all" && store.trend_name && (
                        <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {store.trend_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{store.address}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {(() => {
                      const url = store.place_url || `https://map.naver.com/p/search/${encodeURIComponent(store.name)}`;
                      const isKakao = url.includes("kakao");
                      const isNaver = url.includes("naver");
                      const label = isKakao ? "카카오" : isNaver ? "네이버" : "지도 보기";
                      const cls = isKakao
                        ? "bg-yellow-400 text-black text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-yellow-500 transition-colors"
                        : isNaver
                          ? "bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-green-600 transition-colors"
                          : "bg-gray-400 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-gray-500 transition-colors";
                      return (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openExternalUrl(url);
                          }}
                          className={cls}
                        >
                          {label}
                        </a>
                      );
                    })()}
                    <a
                      href={`https://www.instagram.com/explore/tags/${encodeURIComponent(
                        store.name.replace(/\s/g, "")
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openInstagramTag(store.name);
                      }}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:opacity-90 transition-opacity"
                    >
                      인스타
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
