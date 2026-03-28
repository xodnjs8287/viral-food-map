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
}

function escapeInfoWindowText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
}: KakaoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const markerMapRef = useRef<
    Map<string, { marker: kakao.maps.Marker; infoWindow: kakao.maps.InfoWindow }>
  >(new Map());
  const openInfoWindowRef = useRef<kakao.maps.InfoWindow | null>(null);
  const currentLocationOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);

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

    const newMap = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level,
    });

    const emitBounds = () => {
      if (!onBoundsChange) return;
      const b = newMap.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      onBoundsChange({
        sw: { lat: sw.getLat(), lng: sw.getLng() },
        ne: { lat: ne.getLat(), lng: ne.getLng() },
        level: newMap.getLevel(),
      });
    };

    kakao.maps.event.addListener(newMap, "idle", emitBounds);
    setTimeout(emitBounds, 500);

    setMap(newMap);

    return () => {
      if (currentLocationOverlayRef.current) {
        currentLocationOverlayRef.current.setMap(null);
        currentLocationOverlayRef.current = null;
      }
    };
  }, [loaded, center.lat, center.lng, level]);

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

    const markers: kakao.maps.Marker[] = [];
    const bounds = new kakao.maps.LatLngBounds();
    const newMarkerMap = new Map<
      string,
      { marker: kakao.maps.Marker; infoWindow: kakao.maps.InfoWindow }
    >();

    stores.forEach((store) => {
      const position = new kakao.maps.LatLng(store.lat, store.lng);
      bounds.extend(position);

      const marker = new kakao.maps.Marker({ position, map });
      const storeName = escapeInfoWindowText(store.name);
      const storeAddress = escapeInfoWindowText(store.address);
      const storePhone = store.phone ? escapeInfoWindowText(store.phone) : null;

      const infoContent = `
        <div class="kakao-store-infowindow">
          <strong class="kakao-store-infowindow__name">${storeName}</strong>
          <span class="kakao-store-infowindow__address">${storeAddress}</span>
          ${
            storePhone
              ? `<span class="kakao-store-infowindow__phone">📞 ${storePhone}</span>`
              : ""
          }
        </div>
      `;

      const infoWindow = new kakao.maps.InfoWindow({
        content: infoContent,
        removable: true,
      });

      kakao.maps.event.addListener(marker, "click", () => {
        if (openInfoWindowRef.current) openInfoWindowRef.current.close();
        infoWindow.open(map, marker);
        openInfoWindowRef.current = infoWindow;
        onMarkerClick?.(store.id);
      });

      newMarkerMap.set(store.id, { marker, infoWindow });
      markers.push(marker);
    });

    markerMapRef.current = newMarkerMap;

    if (autoFitBounds) {
      if (stores.length === 1) {
        map.setCenter(new kakao.maps.LatLng(stores[0].lat, stores[0].lng));
        map.setLevel(4);
      } else {
        map.setBounds(bounds);
      }
    }

    const clusterer = new kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: 6,
    });
    clusterer.addMarkers(markers);

    return () => {
      clusterer.clear();
      markers.forEach((m) => m.setMap(null));
      markerMapRef.current.clear();
    };
  }, [map, stores]);

  // React to external selection (from StoreList click)
  useEffect(() => {
    if (!map || !selectedStoreId) return;
    const entry = markerMapRef.current.get(selectedStoreId);
    if (!entry) return;

    if (openInfoWindowRef.current) openInfoWindowRef.current.close();
    map.panTo(entry.marker.getPosition());
    entry.infoWindow.open(map, entry.marker);
    openInfoWindowRef.current = entry.infoWindow;
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
