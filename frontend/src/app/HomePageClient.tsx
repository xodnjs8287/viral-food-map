"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import InstallPrompt from "@/components/InstallPrompt";
import PushSubscribeButton from "@/components/PushSubscribeButton";
import ScrollToTop from "@/components/ScrollToTop";
import TrendCard from "@/components/TrendCard";
import YomechuLauncher from "@/components/YomechuLauncher";
import YomechuLocationPickerModal from "@/components/YomechuLocationPickerModal";
import { getCurrentPosition } from "@/lib/native-geolocation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import YomechuRevealModal from "@/components/YomechuRevealModal";
import {
  fetchYomechuSpin,
  formatDistanceMeters,
  sendYomechuFeedback,
} from "@/lib/crawler";
import { openExternalUrl } from "@/lib/external-links";
import { getAddressLabelFromCoords } from "@/lib/kakao-loader";
import { DEFAULT_MAP_CENTER, hasUsableCoordinates } from "@/lib/location";
import { SITE_URL } from "@/lib/site";
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
  source: "device" | "preset" | "manual";
}

interface GroupedNearbyStore extends NearbyTrendStore {
  trend_names: string[];
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

function getVisibleTrendNames(trendNames: string[]) {
  return trendNames.slice(0, 2);
}

function buildYomechuShareUrl(spinId: string) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : SITE_URL;
  return new URL(`/yomechu/share/${spinId}`, baseUrl).toString();
}

function groupNearbyStores(stores: NearbyTrendStore[]) {
  const grouped = new Map<string, GroupedNearbyStore>();

  for (const store of stores) {
    const key = store.place_url || `${store.name}::${store.address}`;
    const nextTrendNames = store.trend_name ? [store.trend_name] : [];
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        ...store,
        trend_names: nextTrendNames,
      });
      continue;
    }

    grouped.set(key, {
      ...current,
      distance_km: Math.min(current.distance_km, store.distance_km),
      trend_names: Array.from(
        new Set([...current.trend_names, ...nextTrendNames])
      ),
    });
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 5);
}

export default function HomePageClient({
  initialTrends,
  verifiedStoreCount,
  lastUpdated,
}: HomePageClientProps) {
  const [trends, setTrends] = useState<Trend[]>(initialTrends);
  const [nearbyStores, setNearbyStores] = useState<GroupedNearbyStore[]>([]);
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
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

  useEffect(() => {
    if (launcherOpen) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [launcherOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextParams = new URLSearchParams(window.location.search);
    if (nextParams.get("openYomechu") !== "1") {
      return;
    }

    setLauncherOpen(true);
    nextParams.delete("openYomechu");
    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname;

    window.history.replaceState({}, "", nextUrl);
  }, []);

  const updateBaseLocationLabel = useCallback(
    (
      source: YomechuBaseLocation["source"],
      coords: { lat: number; lng: number },
      fallbackLabel: string
    ) => {
      void getAddressLabelFromCoords(coords.lat, coords.lng)
        .then((address) => {
          setYomechuBaseLocation((current) => {
            if (
              !current ||
              current.source !== source ||
              current.lat !== coords.lat ||
              current.lng !== coords.lng
            ) {
              return current;
            }

            return {
              ...current,
              label: address ?? fallbackLabel,
            };
          });
        })
        .catch(() => {
          setYomechuBaseLocation((current) => {
            if (
              !current ||
              current.source !== source ||
              current.lat !== coords.lat ||
              current.lng !== coords.lng
            ) {
              return current;
            }

            return {
              ...current,
              label: fallbackLabel,
            };
          });
        });
    },
    []
  );

  const requestUserLocation = useCallback(() => {
    setLocationStatus("loading");

    getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 })
      .then((nextLocation) => {
        if (!hasUsableCoordinates(nextLocation)) {
          throw new Error("INVALID_POSITION");
        }

        setUserLoc(nextLocation);
        setYomechuBaseLocation({
          ...nextLocation,
          label: "현재 위치",
          source: "device",
        });
        setLocationStatus("granted");
        updateBaseLocationLabel("device", nextLocation, "현재 위치");
      })
      .catch((error) => {
        setUserLoc(null);
        setYomechuBaseLocation((current) =>
          current && current.source !== "device" ? current : null
        );

        if (!(error instanceof Error)) {
          setLocationStatus("invalid");
          return;
        }

        switch (error.message) {
          case "PERMISSION_DENIED":
            setLocationStatus("denied");
            break;
          case "GEOLOCATION_NOT_SUPPORTED":
            setLocationStatus("unsupported");
            break;
          case "INVALID_POSITION":
          case "POSITION_UNAVAILABLE":
          case "TIMEOUT":
            setLocationStatus("invalid");
            break;
          default:
            setLocationStatus("invalid");
            break;
        }
      });
  }, [updateBaseLocationLabel]);

  const handleUsePresetLocation = useCallback((preset: YomechuLocationPreset) => {
    setYomechuBaseLocation({
      lat: preset.lat,
      lng: preset.lng,
      label: preset.label,
      source: "preset",
    });
    setYomechuError(null);
    updateBaseLocationLabel(
      "preset",
      { lat: preset.lat, lng: preset.lng },
      preset.label
    );
  }, [updateBaseLocationLabel]);

  const handleConfirmManualLocation = useCallback(
    (selection: { lat: number; lng: number; label: string }) => {
      setYomechuBaseLocation({
        lat: selection.lat,
        lng: selection.lng,
        label: selection.label,
        source: "manual",
      });
      setYomechuError(null);
      setLocationPickerOpen(false);
    },
    []
  );

  const fetchTrends = useCallback(async () => {
    const { data, error } = await supabase
      .from("trends")
      .select("*, stores(count)")
      .in("status", ["rising", "active"])
      .order("peak_score", { ascending: false });

    if (error || !data) {
      // 에러 시 기존 데이터 유지, 빈 화면 방지
      setLoading(false);
      return;
    }

    if (data.length > 0) {
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
    if (!hasUsableCoordinates(userLoc)) {
      setNearbyStores([]);
      return;
    }

    const fetchNearby = async () => {
      const { data } = await supabase.rpc("get_nearby_trend_stores", {
        user_lat: userLoc.lat,
        user_lng: userLoc.lng,
        result_limit: 20,
      });

      setNearbyStores(groupNearbyStores((data as NearbyTrendStore[]) ?? []));
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
    locationStatus === "denied" ||
    locationStatus === "invalid" ||
    locationStatus === "unsupported";
  const locationPickerInitialCenter = hasUsableCoordinates(yomechuBaseLocation)
    ? yomechuBaseLocation
    : hasUsableCoordinates(userLoc)
      ? userLoc
      : DEFAULT_MAP_CENTER;
  const locationNoticeTitle =
    locationStatus === "invalid"
      ? "현재 위치가 정확하지 않아 주변 판매처를 표시하지 않았습니다."
      : locationStatus === "unsupported"
        ? "이 브라우저에서는 위치 정보를 읽을 수 없습니다."
        : "위치 권한이 없어 주변 판매처를 아직 보여드리지 못하고 있습니다.";
  const locationNoticeDescription =
    locationStatus === "invalid"
      ? "잘못된 좌표가 감지되어 현재 위치 사용을 중단했습니다. 현재 위치를 다시 확인하거나 기준 위치를 직접 지정해 주세요."
      : locationStatus === "unsupported"
        ? "브라우저 위치 기능 대신 기준 위치를 직접 지정하면 요메추는 계속 사용할 수 있습니다."
        : "브라우저 위치 권한을 허용하면 가까운 판매처를 자동으로 정렬해 보여드립니다.";
  const locationNoticeHint =
    locationStatus === "invalid"
      ? "기준 위치를 직접 선택하면 요메추 추천은 바로 계속 사용할 수 있어요."
      : locationStatus === "unsupported"
        ? "위치 지정하기로 원하는 동네를 고른 뒤 추천을 받아보세요."
        : "위치 권한을 허용하면 주변 판매처를 자동으로 찾아드립니다.";

  const spinYomechu = useCallback(async () => {
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
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

      openExternalUrl(place.place_url);
    },
    [sessionId, yomechuResult]
  );

  const handleShareResult = useCallback(() => {
    if (!yomechuResult?.spin_id) {
      return;
    }

    void sendYomechuFeedback({
      spin_id: yomechuResult.spin_id,
      place_id: yomechuResult.winner.place_id,
      session_id: sessionId || null,
      event_type: "share",
    });
  }, [sessionId, yomechuResult]);

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
            오늘 뭐 먹지?
          </button>
        }
        bottomSlot={
          <YomechuLauncher
            open={launcherOpen}
            locationStatus={locationStatus}
            locationSource={yomechuBaseLocation?.source ?? null}
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
            onOpenLocationPicker={() => setLocationPickerOpen(true)}
            onRetryLocation={requestUserLocation}
            onUsePresetLocation={handleUsePresetLocation}
          />
        }
      />
      <main className="page-with-bottom-nav max-w-lg mx-auto px-4 py-4">
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
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="#trends"
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-purple-50"
              >
                지금 뜨는 트렌드 보기
              </Link>
              <Link
                href="/map"
                className="rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                지도에서 판매처 찾기
              </Link>
            </div>
            {lastUpdatedLabel ? (
              <p className="mt-4 text-xs text-white/80">
                최근 트렌드 업데이트: {lastUpdatedLabel}
              </p>
            ) : null}
          </div>
        </section>

        <div id="trends" className="scroll-mt-24">
          {loading ? (
            <section>
              <div className="flex flex-col gap-8">
                {[1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className="bg-white rounded-2xl p-4 animate-pulse h-24"
                  />
                ))}
              </div>
            </section>
          ) : trends.length === 0 ? (
            <section>
              <div className="text-center py-14 text-gray-400">
                <p className="text-5xl mb-4">🍽️</p>
                <p className="font-semibold text-gray-600 text-base">
                  아직 유행하는 음식을 찾는 중이에요!
                </p>
                <p className="text-sm mt-2 text-gray-400">
                  크롤러가 SNS를 샅샅이 뒤지고 있어요 🔍
                </p>
              </div>
            </section>
          ) : (
            <>
              {(() => {
                const viralTrends = trends.filter((t) => t.type === "viral");
                const topTrend = viralTrends[0];
                const restViral = viralTrends.slice(1);
                return viralTrends.length > 0 ? (
                  <>
                    {topTrend && (
                      <section className="mb-8">
                        <Link href={`/trend/${topTrend.id}`}>
                          <div className="relative rounded-2xl overflow-hidden shadow-lg">
                            <div className="relative h-56 w-full bg-gray-100">
                              {topTrend.image_url ? (
                                <Image
                                  src={topTrend.image_url}
                                  alt={topTrend.name}
                                  fill
                                  sizes="(max-width: 512px) 100vw, 512px"
                                  className="object-cover"
                                  priority
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center text-6xl">
                                  🔥
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                              <div className="absolute top-3 left-3">
                                <span className="bg-red-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                                  🔥 지금 가장 핫한
                                </span>
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 p-4">
                                <h2 className="text-2xl font-bold text-white tracking-[-0.03em]">{topTrend.name}</h2>
                                <p className="text-sm text-white/85 mt-1 line-clamp-2">
                                  {topTrend.description || "곧 설명이 추가됩니다"}
                                </p>
                                <div className="flex items-center gap-3 mt-2 text-xs text-white/70">
                                  <span>인기도 {Math.min(topTrend.peak_score, 100)}%</span>
                                  <span>판매처 {topTrend.store_count || 0}곳</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </Link>
                      </section>
                    )}
                    {restViral.length > 0 && (
                      <section className="mb-8">
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="font-bold text-gray-900">🔥 지금 뜨는 트렌드</h3>
                          <span className="text-xs text-gray-400">
                            {restViral.length}개
                          </span>
                        </div>
                        <div className="flex flex-col gap-8">
                          {restViral.map((trend) => (
                            <TrendCard key={trend.id} trend={trend} />
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                ) : null;
              })()}

              {trends.filter((t) => t.type === "steady").length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900">🏅 스테디셀러</h3>
                    <span className="text-xs text-gray-400">
                      {trends.filter((t) => t.type === "steady").length}개
                    </span>
                  </div>
                  <div className="flex flex-col gap-8">
                    {trends
                      .filter((t) => t.type === "steady")
                      .map((trend) => (
                        <TrendCard key={trend.id} trend={trend} />
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {showLocationNotice ? (
          <section className="mb-6 mt-8">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-semibold text-amber-900">
                {locationNoticeTitle}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-amber-800">
                {locationNoticeDescription}
              </p>
              <p className="mt-2 text-xs leading-5 text-amber-700">
                {locationNoticeHint}
              </p>
              <div className="mt-3 flex gap-2">
                {locationStatus === "unsupported" ? (
                  <button
                    onClick={() => setLocationPickerOpen(true)}
                    className="inline-flex rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-950"
                  >
                    기준 위치 선택하기
                  </button>
                ) : (
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
                    {locationStatus === "invalid"
                      ? "현재 위치 다시 확인하기"
                      : "위치 권한 허용하기"}
                  </button>
                )}
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
          <section className="mb-6 mt-8">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">내 근처 판매처</h3>
                <p className="mt-1 text-xs text-gray-500">
                  트렌드를 확인했다면, 이제 가까운 판매처를 바로 찾아보세요.
                </p>
              </div>
              <Link href="/map" className="text-xs text-primary font-medium">
                지도에서 보기
              </Link>
            </div>
            <div className="space-y-2">
              {nearbyStores.map((store) => (
                <div
                  key={store.place_url || `${store.name}-${store.address}`}
                  className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-lg flex-shrink-0">
                    📍
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="min-w-0 flex-1 font-semibold text-sm text-gray-900 truncate">
                        {store.name}
                      </h4>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{store.address}</p>
                    {store.trend_names.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {getVisibleTrendNames(store.trend_names).map((trendName) => (
                          <span
                            key={trendName}
                            className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                          >
                            {trendName}
                          </span>
                        ))}
                        {store.trend_names.length > 2 ? (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            외 {store.trend_names.length - 2}개
                          </span>
                        ) : null}
                      </div>
                    ) : null}
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

        <div className="mt-8">
          <InstallPrompt />
        </div>

        <div className="mb-2 mt-4 flex justify-center">
          <PushSubscribeButton />
        </div>
        <Footer />
      </main>
      <ScrollToTop />
      <YomechuLocationPickerModal
        isOpen={locationPickerOpen}
        initialCenter={locationPickerInitialCenter}
        initialLabel={yomechuBaseLocation?.label ?? null}
        onClose={() => setLocationPickerOpen(false)}
        onConfirm={handleConfirmManualLocation}
      />
      <YomechuRevealModal
        isOpen={revealOpen}
        isLoading={yomechuLoading}
        error={yomechuError}
        result={yomechuResult}
        onBack={handleBackToLauncher}
        onClose={handleCloseReveal}
        onReroll={handleReroll}
        onOpenPlace={handleOpenPlace}
        onShare={handleShareResult}
        shareUrl={
          yomechuResult?.spin_id ? buildYomechuShareUrl(yomechuResult.spin_id) : null
        }
      />
      <BottomNav />
    </>
  );
}
