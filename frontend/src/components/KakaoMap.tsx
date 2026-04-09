"use client";

import { useEffect, useRef, useState } from "react";
import type { Store } from "@/lib/types";
import { getCurrentPosition } from "@/lib/native-geolocation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

export interface MapBounds {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
  level: number;
}

interface KakaoMapProps {
  stores: Store[];
  center?: { lat: number; lng: number };
  currentLocation?: { lat: number; lng: number } | null;
  level?: number;
  className?: string;
  selectedStoreId?: string | null;
  onMarkerClick?: (storeId: string) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  autoFitBounds?: boolean;
  onRequestCurrentLocation?: () => Promise<{ lat: number; lng: number } | null>;
  /** trend_id → 트렌드 이름 매핑 (지도 마커에 트렌드 라벨 표시) */
  trendLabels?: Record<string, string>;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MARKER_COLORS = [
  "#9B7DD4", "#E8726E", "#4A9BD9", "#F5A623", "#50C878",
  "#FF6B9D", "#45B7D1", "#96CEB4", "#D4A574", "#7B68EE",
];

function getTrendColor(trendId: string, allTrendIds: string[]): string {
  const idx = allTrendIds.indexOf(trendId);
  return MARKER_COLORS[idx >= 0 ? idx % MARKER_COLORS.length : 0];
}

export default function KakaoMap({
  stores,
  center = { lat: 37.5665, lng: 126.978 },
  currentLocation = null,
  level = 5,
  className = "map-container",
  selectedStoreId,
  onMarkerClick,
  onBoundsChange,
  autoFitBounds = true,
  onRequestCurrentLocation,
  trendLabels = {},
}: KakaoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const markerMapRef = useRef<
    Map<string, { markerOverlay: kakao.maps.CustomOverlay; infoOverlay: kakao.maps.CustomOverlay }>
  >(new Map());
  const openOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  const selectedStoreIdRef = useRef(selectedStoreId);
  const currentLocationOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tryLoad = () => {
      if (window.kakao?.maps) {
        kakao.maps.load(() => setLoaded(true));
        return true;
      }
      return false;
    };

    if (tryLoad()) return;

    // SDK가 아직 안 왔으면 폴링 (최대 10초)
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      if (tryLoad() || attempts >= 40) {
        clearInterval(interval);
      }
    }, 250);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;

    // Kakao Map appends its own layer DOM into the container.
    // Clear stale layers before initializing so a prop change cannot leave maps stacked.
    mapRef.current.innerHTML = "";

    const newMap = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level,
    });

    const emitBounds = () => {
      if (!onBoundsChangeRef.current) return;
      const b = newMap.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      onBoundsChangeRef.current({
        sw: { lat: sw.getLat(), lng: sw.getLng() },
        ne: { lat: ne.getLat(), lng: ne.getLng() },
        level: newMap.getLevel(),
      });
    };

    kakao.maps.event.addListener(newMap, "idle", emitBounds);
    const emitBoundsTimer = window.setTimeout(emitBounds, 500);

    setMap(newMap);

    return () => {
      window.clearTimeout(emitBoundsTimer);
      if (currentLocationOverlayRef.current) {
        currentLocationOverlayRef.current.setMap(null);
        currentLocationOverlayRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.innerHTML = "";
      }
    };
  }, [loaded]);

  useEffect(() => {
    if (!map) return;
    if (autoFitBounds && stores.length > 0) return;

    map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
    map.setLevel(level);
  }, [map, center.lat, center.lng, level, autoFitBounds]);

  useEffect(() => {
    if (!map) return;

    if (currentLocationOverlayRef.current) {
      currentLocationOverlayRef.current.setMap(null);
      currentLocationOverlayRef.current = null;
    }

    if (!currentLocation) return;

    const markerContent = document.createElement("div");
    markerContent.innerHTML = `
      <div style="width:16px;height:16px;background:#4A90D9;border:3px solid white;border-radius:50%;box-shadow:0 0 6px rgba(74,144,217,0.5);"></div>
    `;

    const overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(currentLocation.lat, currentLocation.lng),
      content: markerContent,
      map,
      zIndex: 10,
    });

    currentLocationOverlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
      if (currentLocationOverlayRef.current === overlay) {
        currentLocationOverlayRef.current = null;
      }
    };
  }, [map, currentLocation?.lat, currentLocation?.lng]);

  useEffect(() => {
    if (!map || stores.length === 0) return;

    const CLUSTER_MIN_LEVEL = 6;
    const allTrendIds = Object.keys(trendLabels);
    const bounds = new kakao.maps.LatLngBounds();
    const newMarkerMap = new Map<
      string,
      { markerOverlay: kakao.maps.CustomOverlay; infoOverlay: kakao.maps.CustomOverlay }
    >();

    const closeOpenOverlay = () => {
      if (openOverlayRef.current) {
        openOverlayRef.current.setMap(null);
        openOverlayRef.current = null;
      }
    };

    kakao.maps.event.addListener(map, "click", closeOpenOverlay);

    // 각 store에 대한 핀·정보 오버레이 생성 (아직 map에 붙이지 않음)
    type StoreEntry = {
      store: Store;
      position: kakao.maps.LatLng;
      markerOverlay: kakao.maps.CustomOverlay;
      infoOverlay: kakao.maps.CustomOverlay;
    };
    const entries: StoreEntry[] = [];

    stores.forEach((store) => {
      const position = new kakao.maps.LatLng(store.lat, store.lng);
      bounds.extend(position);

      const trendName = trendLabels[store.trend_id];
      const color = getTrendColor(store.trend_id, allTrendIds);
      const label = trendName ? escapeHtml(trendName) : "📍";

      const pinEl = document.createElement("div");
      pinEl.className = "kakao-trend-pin";
      pinEl.innerHTML = `
        <div class="kakao-trend-pin__label" style="background:${color};">${label}</div>
        <div class="kakao-trend-pin__tail" style="border-top-color:${color};"></div>
      `;

      const markerOverlay = new kakao.maps.CustomOverlay({
        content: pinEl,
        position,
        yAnchor: 1,
        zIndex: 5,
      });

      const storeName = escapeHtml(store.name);
      const storeAddress = escapeHtml(store.address);
      const storePhone = store.phone ? escapeHtml(store.phone) : null;

      const overlayContent = document.createElement("div");
      overlayContent.className = "kakao-store-overlay";
      overlayContent.innerHTML = `
        <div class="kakao-store-overlay__content">
          <button class="kakao-store-overlay__close" aria-label="닫기">&times;</button>
          <strong class="kakao-store-infowindow__name">${storeName}</strong>
          <span class="kakao-store-infowindow__address">${storeAddress}</span>
          ${
            storePhone
              ? `<span class="kakao-store-infowindow__phone">📞 ${storePhone}</span>`
              : ""
          }
        </div>
        <div class="kakao-store-overlay__tail"></div>
      `;

      const infoOverlay = new kakao.maps.CustomOverlay({
        content: overlayContent,
        position,
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: 20,
      });

      overlayContent.querySelector(".kakao-store-overlay__close")?.addEventListener("click", (e) => {
        e.stopPropagation();
        infoOverlay.setMap(null);
        if (openOverlayRef.current === infoOverlay) openOverlayRef.current = null;
      });

      pinEl.addEventListener("click", () => {
        closeOpenOverlay();
        infoOverlay.setMap(map);
        openOverlayRef.current = infoOverlay;
        onMarkerClick?.(store.id);
      });

      newMarkerMap.set(store.id, { markerOverlay, infoOverlay });
      entries.push({ store, position, markerOverlay, infoOverlay });
    });

    markerMapRef.current = newMarkerMap;

    // 클러스터링 상태 관리
    let clusterOverlays: kakao.maps.CustomOverlay[] = [];

    const renderClusters = () => {
      // 기존 클러스터 뱃지 제거
      clusterOverlays.forEach((o) => o.setMap(null));
      clusterOverlays = [];

      const currentLevel = map.getLevel();

      if (currentLevel < CLUSTER_MIN_LEVEL) {
        // 줌 인 상태: 개별 핀 모두 표시
        entries.forEach((e) => e.markerOverlay.setMap(map));
        return;
      }

      // 줌 아웃 상태: 격자 기반 클러스터링
      const gridSize = 0.001 * Math.pow(2, currentLevel - 2);
      const grid = new Map<string, StoreEntry[]>();

      for (const entry of entries) {
        const key = `${Math.floor(entry.store.lat / gridSize)}_${Math.floor(entry.store.lng / gridSize)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(entry);
      }

      for (const group of grid.values()) {
        if (group.length === 1) {
          // 단독 핀은 그대로 표시
          group[0].markerOverlay.setMap(map);
        } else {
          // 그룹: 개별 핀 숨기고 클러스터 뱃지 표시
          group.forEach((e) => e.markerOverlay.setMap(null));

          const centerLat = group.reduce((s, e) => s + e.store.lat, 0) / group.length;
          const centerLng = group.reduce((s, e) => s + e.store.lng, 0) / group.length;

          const badgeEl = document.createElement("div");
          badgeEl.className = "kakao-cluster-badge";
          badgeEl.textContent = String(group.length);

          // 클러스터 클릭 시 줌 인
          badgeEl.addEventListener("click", () => {
            map.setCenter(new kakao.maps.LatLng(centerLat, centerLng));
            map.setLevel(Math.max(1, currentLevel - 2));
          });

          const badge = new kakao.maps.CustomOverlay({
            content: badgeEl,
            position: new kakao.maps.LatLng(centerLat, centerLng),
            yAnchor: 0.5,
            xAnchor: 0.5,
            zIndex: 15,
          });
          badge.setMap(map);
          clusterOverlays.push(badge);
        }
      }
    };

    renderClusters();
    kakao.maps.event.addListener(map, "idle", renderClusters);

    // stores 재생성 후 선택된 store의 툴팁 복원
    const currentSelected = selectedStoreIdRef.current;
    if (currentSelected) {
      const entry = newMarkerMap.get(currentSelected);
      if (entry) {
        entry.infoOverlay.setMap(map);
        openOverlayRef.current = entry.infoOverlay;
      }
    }

    if (autoFitBounds) {
      if (stores.length === 1) {
        map.setCenter(new kakao.maps.LatLng(stores[0].lat, stores[0].lng));
        map.setLevel(4);
      } else {
        map.setBounds(bounds);
      }
    }

    return () => {
      closeOpenOverlay();
      kakao.maps.event.removeListener(map, "click", closeOpenOverlay);
      kakao.maps.event.removeListener(map, "idle", renderClusters);
      clusterOverlays.forEach((o) => o.setMap(null));
      newMarkerMap.forEach(({ markerOverlay, infoOverlay }) => {
        markerOverlay.setMap(null);
        infoOverlay.setMap(null);
      });
      markerMapRef.current.clear();
    };
  }, [map, stores, trendLabels]);

  // React to external selection (from StoreList click)
  useEffect(() => {
    if (!map || !selectedStoreId) return;
    const entry = markerMapRef.current.get(selectedStoreId);
    if (!entry) return;

    if (openOverlayRef.current) {
      openOverlayRef.current.setMap(null);
      openOverlayRef.current = null;
    }
    map.panTo(entry.markerOverlay.getPosition());
    entry.infoOverlay.setMap(map);
    openOverlayRef.current = entry.infoOverlay;
  }, [map, selectedStoreId]);

  const panToLocation = (location: { lat: number; lng: number }) => {
    if (!map) return;
    const loc = new kakao.maps.LatLng(location.lat, location.lng);
    map.panTo(loc);
    map.setLevel(4);
  };

  const moveToMyLocation = async () => {
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    if (!map) return;

    if (currentLocation) {
      panToLocation(currentLocation);
      return;
    }

    if (onRequestCurrentLocation) {
      const nextLocation = await onRequestCurrentLocation();
      if (nextLocation) {
        panToLocation(nextLocation);
      }
      return;
    }

    getCurrentPosition({ timeout: 8000 })
      .then((loc) => panToLocation(loc))
      .catch(() => {});
  };

  if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) {
    return (
      <div className={`${className} bg-gray-100 flex items-center justify-center`}>
        <p className="text-gray-400 text-sm">카카오맵 API 키가 필요합니다</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={mapRef} className={className} />
      <button
        type="button"
        onClick={() => {
          void moveToMyLocation();
        }}
        className="absolute bottom-3 right-3 z-10 bg-white rounded-full shadow-md px-3 py-2 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-primary hover:shadow-lg transition-all"
        title="내 위치로 이동"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        내 위치
      </button>
    </div>
  );
}
