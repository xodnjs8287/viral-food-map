"use client";

import { useEffect, useRef, useState } from "react";
import type { Store } from "@/lib/types";

export interface MapBounds {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
  level: number;
}

interface KakaoMapProps {
  stores: Store[];
  center?: { lat: number; lng: number };
  level?: number;
  className?: string;
  selectedStoreId?: string | null;
  onMarkerClick?: (storeId: string) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  autoFitBounds?: boolean;
}

export default function KakaoMap({
  stores,
  center = { lat: 37.5665, lng: 126.978 },
  level = 5,
  className = "map-container",
  selectedStoreId,
  onMarkerClick,
  onBoundsChange,
  autoFitBounds = true,
}: KakaoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const markerMapRef = useRef<
    Map<string, { marker: kakao.maps.Marker; infoWindow: kakao.maps.InfoWindow }>
  >(new Map());
  const openInfoWindowRef = useRef<kakao.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.kakao?.maps) return;
    kakao.maps.load(() => setLoaded(true));
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

    // 현재 위치 마커 (파란 점)
    const markerContent = document.createElement("div");
    markerContent.innerHTML = `
      <div style="width:16px;height:16px;background:#4A90D9;border:3px solid white;border-radius:50%;box-shadow:0 0 6px rgba(74,144,217,0.5);"></div>
    `;
    new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(center.lat, center.lng),
      content: markerContent,
      map: newMap,
      zIndex: 10,
    });

    setMap(newMap);
  }, [loaded, center.lat, center.lng, level]);

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

      const infoContent = `
        <div style="padding:8px 12px;min-width:150px;font-size:13px;line-height:1.4;">
          <strong>${store.name}</strong><br/>
          <span style="color:#666;font-size:11px;">${store.address}</span>
          ${store.phone ? `<br/><span style="color:#9B7DD4;font-size:11px;">📞 ${store.phone}</span>` : ""}
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

  const moveToMyLocation = () => {
    if (!map) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        map.panTo(loc);
        map.setLevel(4);
      },
      () => {}
    );
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
        onClick={moveToMyLocation}
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
