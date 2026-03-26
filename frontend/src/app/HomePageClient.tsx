"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import InstallPrompt from "@/components/InstallPrompt";
import TrendCard from "@/components/TrendCard";
import YomechuLauncher from "@/components/YomechuLauncher";
import YomechuRevealModal from "@/components/YomechuRevealModal";
import {
  fetchYomechuSpin,
  formatDistanceMeters,
  sendYomechuFeedback,
} from "@/lib/crawler";
import { supabase } from "@/lib/supabase";
import type {
  LocationStatus,
  NearbyTrendStore,
  Trend,
  YomechuCategorySlug,
  YomechuLocationPreset,
  YomechuPlace,
  YomechuResultCount,
  YomechuSpinResponse,
} from "@/lib/types";

interface YomechuBaseLocation {
  lat: number;
  lng: number;
  label: string;
  source: "device" | "preset";
}

interface HomePageClientProps {
  initialTrends: Trend[];
  verifiedStoreCount: number;
  lastUpdated: string | null;
}

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}`;
}

export default function HomePageClient({
  initialTrends,
  verifiedStoreCount,
  lastUpdated,
}: HomePageClientProps) {
  const [trends, setTrends] = useState<Trend[]>(initialTrends);
  const [nearbyStores, setNearbyStores] = useState<NearbyTrendStore[]>([]);
  const [loading, setLoading] = useState(initialTrends.length === 0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [yomechuBaseLocation, setYomechuBaseLocation] =
    useState<YomechuBaseLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [sessionId, setSessionId] = useState("");
  const [selectedRadius, setSelectedRadius] = useState(1000);
  const [selectedCategory, setSelectedCategory] =
    useState<YomechuCategorySlug>("all");
  const [selectedCount, setSelectedCount] = useState<YomechuResultCount>(3);
  const [yomechuLoading, setYomechuLoading] = useState(false);
  const [yomechuError, setYomechuError] = useState<string | null>(null);
  const [yomechuResult, setYomechuResult] = useState<YomechuSpinResponse | null>(
    null
  );
  const [revealOpen, setRevealOpen] = useState(false);

  useEffect(() => {
    if (launcherOpen) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [launcherOpen]);

  const requestUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      setYomechuBaseLocation((current) =>
        current?.source === "preset" ? current : null
      );
      return;
    }

    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };

        setUserLoc(nextLocation);
        setYomechuBaseLocation({
          ...nextLocation,
          label: "현재 위치",
          source: "device",
        });
        setLocationStatus("granted");
      },
      () => {
        setUserLoc(null);
        setYomechuBaseLocation((current) =>
          current?.source === "preset" ? current : null
        );
        setLocationStatus("denied");
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      }
    );
  }, []);

  const handleUsePresetLocation = useCallback((preset: YomechuLocationPreset) => {
    setYomechuBaseLocation({
      lat: preset.lat,
      lng: preset.lng,
      label: preset.label,
      source: "preset",
    });
    setYomechuError(null);
  }, []);

  const fetchTrends = useCallback(async () => {
    const { data } = await supabase
      .from("trends")
      .select("*, stores(count)")
      .in("status", ["rising", "active"])
      .order("peak_score", { ascending: false });

    if (data) {
      const mapped = data.map(
        (trend: Trend & { stores?: { count: number }[] | null }) => ({
          ...trend,
          store_count: trend.stores?.[0]?.count || 0,
        })
      );
      setTrends(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem("yomechu-session-id");
    if (storedSessionId) {
      setSessionId(storedSessionId);
    } else {
      const nextSessionId = createSessionId();
      window.localStorage.setItem("yomechu-session-id", nextSessionId);
      setSessionId(nextSessionId);
    }

    requestUserLocation();
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
  }, [fetchTrends, requestUserLocation]);

  useEffect(() => {
    if (!userLoc) {
      setNearbyStores([]);
      return;
    }

    const fetchNearby = async () => {
      const { data } = await supabase.rpc("get_nearby_trend_stores", {
        user_lat: userLoc.lat,
        user_lng: userLoc.lng,
        result_limit: 5,
      });

      setNearbyStores((data as NearbyTrendStore[]) ?? []);
    };

    fetchNearby();
  }, [userLoc]);

  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleString("ko-KR", {
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const showLocationNotice =
    locationStatus === "denied" || locationStatus === "unsupported";

  const spinYomechu = useCallback(async () => {
    if (!yomechuBaseLocation || !sessionId) {
      setYomechuError(
        "현재 위치를 확인하거나 기준 지역을 선택한 뒤 다시 시도해 주세요."
      );
      setRevealOpen(true);
      return;
    }

    setYomechuLoading(true);
    setYomechuError(null);
    setYomechuResult(null);
    setRevealOpen(true);
    setLauncherOpen(false);

    try {
      const result = await fetchYomechuSpin({
        lat: yomechuBaseLocation.lat,
        lng: yomechuBaseLocation.lng,
        radius_m: selectedRadius,
        category_slug: selectedCategory,
        result_count: selectedCount,
        session_id: sessionId,
      });
      setYomechuResult(result);
    } catch (error) {
      setYomechuError(
        error instanceof Error
          ? error.message
          : "요메추 추천을 불러오지 못했습니다."
      );
    } finally {
      setYomechuLoading(false);
    }
  }, [
    selectedCategory,
    selectedCount,
    selectedRadius,
    sessionId,
    yomechuBaseLocation,
  ]);

  const handleCloseReveal = useCallback(() => {
    if (yomechuResult?.spin_id && sessionId) {
      void sendYomechuFeedback({
        spin_id: yomechuResult.spin_id,
        place_id: yomechuResult.winner.place_id,
        session_id: sessionId,
        event_type: "close",
      });
    }
    setRevealOpen(false);
  }, [sessionId, yomechuResult]);

  const handleBackToLauncher = useCallback(() => {
    if (yomechuResult?.spin_id && sessionId) {
      void sendYomechuFeedback({
        spin_id: yomechuResult.spin_id,
        place_id: yomechuResult.winner.place_id,
        session_id: sessionId,
        event_type: "close",
      });
    }

    setRevealOpen(false);
    setLauncherOpen(true);
  }, [sessionId, yomechuResult]);

  const handleReroll = useCallback(async () => {
    if (yomechuResult?.spin_id && sessionId) {
      void sendYomechuFeedback({
        spin_id: yomechuResult.spin_id,
        place_id: yomechuResult.winner.place_id,
        session_id: sessionId,
        event_type: "reroll",
      });
    }

    await spinYomechu();
  }, [sessionId, spinYomechu, yomechuResult]);

  const handleOpenPlace = useCallback(
    (place: YomechuPlace) => {
      if (yomechuResult?.spin_id && sessionId) {
        void sendYomechuFeedback({
          spin_id: yomechuResult.spin_id,
          place_id: place.place_id,
          session_id: sessionId,
          event_type: "open",
          payload: {
            place_url: place.place_url,
          },
        });
      }

      window.open(place.place_url, "_blank", "noopener,noreferrer");
    },
    [sessionId, yomechuResult]
  );

  return (
    <>
      <Header
        rightSlot={
          <button
            type="button"
            onClick={() => setLauncherOpen((open) => !open)}
            aria-expanded={launcherOpen}
            aria-haspopup="dialog"
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] transition-colors ${
              launcherOpen
                ? "border-primary bg-primary text-white"
                : "border-primary/20 bg-primary/5 text-primary hover:border-primary/40 hover:bg-primary/10"
            }`}
          >
            요메추
          </button>
        }
        bottomSlot={
          <YomechuLauncher
            open={launcherOpen}
            locationStatus={locationStatus}
            locationLabel={yomechuBaseLocation?.label ?? null}
            hasBaseLocation={Boolean(yomechuBaseLocation)}
            selectedRadius={selectedRadius}
            selectedCategory={selectedCategory}
            selectedCount={selectedCount}
            isSubmitting={yomechuLoading}
            error={yomechuError}
            onRadiusChange={setSelectedRadius}
            onCategoryChange={setSelectedCategory}
            onCountChange={setSelectedCount}
            onSpin={spinYomechu}
            onRetryLocation={requestUserLocation}
            onUsePresetLocation={handleUsePresetLocation}
          />
        }
      />
      <main className="max-w-lg mx-auto px-4 py-4">
        <section className="mb-6">
          <div className="bg-gradient-to-br from-purple-400 to-blue-400 rounded-2xl px-6 py-6 text-white">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-white/90">
              <span className="rounded-full bg-white/15 px-2.5 py-1">
                활성 트렌드 {trends.length}개
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-1">
                검증 판매처 {verifiedStoreCount.toLocaleString("ko-KR")}곳
              </span>
            </div>
            <p className="mt-4 text-xl font-bold leading-snug">
              SNS에서 뜨는 음식,
              <br />
              어디서 살지 바로 찾는 지도
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/85">
              실시간 트렌드와 주변 판매처를 한 번에 확인하세요.
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href="/map"
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-purple-50"
              >
                지도 바로 보기
              </Link>
              <Link
                href="/report"
                className="rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                판매처 제보
              </Link>
            </div>
            {lastUpdatedLabel ? (
              <p className="mt-4 text-xs text-white/80">
                최근 트렌드 업데이트: {lastUpdatedLabel}
              </p>
            ) : null}
          </div>
        </section>

        <InstallPrompt />

        {showLocationNotice ? (
          <section className="mb-6">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-semibold text-amber-900">
                위치 권한이 없어 주변 판매처를 아직 보여드리지 못하고 있습니다.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-amber-800">
                브라우저 위치 권한을 허용하면 가까운 판매처를 자동으로 정렬해 보여드립니다.
              </p>
              <p className="mt-2 text-xs leading-5 text-amber-700">
                위치 권한을 허용하면 주변 판매처를 자동으로 찾아드립니다.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      const perm = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
                      if (perm?.state === "denied") {
                        alert("위치 권한이 차단되어 있습니다.\n\n[설정 방법]\n• 브라우저: 주소창 🔒 아이콘 → 위치 → 허용\n• 앱(PWA): 기기 설정 → 앱 → 브라우저 → 위치 권한 허용\n\n변경 후 새로고침해 주세요.");
                        return;
                      }
                    } catch {}
                    requestUserLocation();
                  }}
                  className="inline-flex rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-950"
                >
                  위치 권한 허용하기
                </button>
                <Link
                  href="/map"
                  className="inline-flex rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                >
                  지도에서 보기
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {nearbyStores.length > 0 ? (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between">
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
                      {store.trend_name ? (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {store.trend_name}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{store.address}</p>
                  </div>
                  <span className="text-xs text-primary font-semibold flex-shrink-0">
                    {formatDistanceMeters(
                      Math.max(Math.round(store.distance_km * 1000), 0)
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">트렌드 목록</h3>
            <span className="text-xs text-gray-400">{trends.length}개 트렌드</span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-8">
              {[1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="bg-white rounded-2xl p-4 animate-pulse h-24"
                />
              ))}
            </div>
          ) : trends.length === 0 ? (
            <div className="text-center py-14 text-gray-400">
              <p className="text-5xl mb-4">🍽️</p>
              <p className="font-semibold text-gray-600 text-base">
                아직 유행하는 음식을 찾는 중이에요!
              </p>
              <p className="text-sm mt-2 text-gray-400">
                크롤러가 SNS를 샅샅이 뒤지고 있어요 🔍
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {trends.map((trend) => (
                <TrendCard key={trend.id} trend={trend} />
              ))}
            </div>
          )}
        </section>
        <Footer />
      </main>
      <YomechuRevealModal
        isOpen={revealOpen}
        isLoading={yomechuLoading}
        error={yomechuError}
        result={yomechuResult}
        onBack={handleBackToLauncher}
        onClose={handleCloseReveal}
        onReroll={handleReroll}
        onOpenPlace={handleOpenPlace}
      />
      <BottomNav />
    </>
  );
}
