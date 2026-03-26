"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const KAKAO_MAPS_SCRIPT_ID = "yomechu-kakao-sdk-maps";

type Coordinates = {
  lat: number;
  lng: number;
};

interface YomechuLocationPickerModalProps {
  isOpen: boolean;
  initialCenter: Coordinates;
  onClose: () => void;
  onConfirm: (coords: Coordinates) => void;
}

let kakaoMapsPromise: Promise<void> | null = null;

function loadExternalScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(id) as HTMLScriptElement | null;
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${id}`)),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${id}`)),
      { once: true }
    );
    document.head.appendChild(script);
  });
}

function ensureKakaoMapsLoaded() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available."));
  }

  if (window.kakao?.maps) {
    return new Promise<void>((resolve) => {
      kakao.maps.load(() => resolve());
    });
  }

  if (kakaoMapsPromise) {
    return kakaoMapsPromise;
  }

  const kakaoMapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  if (!kakaoMapKey) {
    return Promise.reject(new Error("Kakao Map key is missing."));
  }

  const mapsUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoMapKey}&autoload=false&libraries=services,clusterer`;

  kakaoMapsPromise = (async () => {
    await loadExternalScript(KAKAO_MAPS_SCRIPT_ID, mapsUrl);

    await new Promise<void>((resolve) => {
      kakao.maps.load(() => resolve());
    });
  })().catch((error) => {
    kakaoMapsPromise = null;
    throw error;
  });

  return kakaoMapsPromise;
}

export default function YomechuLocationPickerModal({
  isOpen,
  initialCenter,
  onClose,
  onConfirm,
}: YomechuLocationPickerModalProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<kakao.maps.Marker | null>(null);

  const [selectedCoords, setSelectedCoords] = useState<Coordinates>(initialCenter);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coordinateLabel = useMemo(
    () => `${selectedCoords.lat.toFixed(5)}, ${selectedCoords.lng.toFixed(5)}`,
    [selectedCoords]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedCoords(initialCenter);
  }, [initialCenter, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const scrollY = window.scrollY;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyPosition = document.body.style.position;
    const originalBodyTop = document.body.style.top;
    const originalBodyWidth = document.body.style.width;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.position = originalBodyPosition;
      document.body.style.top = originalBodyTop;
      document.body.style.width = originalBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !mapElementRef.current) {
      return;
    }

    let disposed = false;

    const initializeMap = async () => {
      setLoading(true);
      setError(null);

      try {
        await ensureKakaoMapsLoaded();
        if (disposed || !mapElementRef.current) {
          return;
        }

        const center = new kakao.maps.LatLng(initialCenter.lat, initialCenter.lng);
        const map = new kakao.maps.Map(mapElementRef.current, {
          center,
          level: 4,
        });

        const marker = new kakao.maps.Marker({
          position: center,
          map,
        });

        markerRef.current = marker;

        window.requestAnimationFrame(() => {
          map.setCenter(center);
        });

        kakao.maps.event.addListener(map, "click", (mouseEvent: { latLng?: kakao.maps.LatLng }) => {
          const latLng = mouseEvent?.latLng;
          if (!latLng) {
            return;
          }

          const nextCoords = {
            lat: latLng.getLat(),
            lng: latLng.getLng(),
          };

          markerRef.current?.setMap(null);
          const nextMarker = new kakao.maps.Marker({
            position: latLng,
            map,
          });

          markerRef.current = nextMarker;
          setSelectedCoords(nextCoords);
          map.panTo(latLng);
        });
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "지도를 불러오지 못했습니다."
        );
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void initializeMap();

    return () => {
      disposed = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
    };
  }, [initialCenter, isOpen]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-950/55 px-4 py-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-4 shadow-[0_24px_70px_rgba(17,24,39,0.24)]"
            role="dialog"
            aria-modal="true"
            aria-label="요메추 위치 지정"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/70">
                  YOMECHU MAP PICKER
                </p>
                <h3 className="mt-1 text-lg font-black tracking-[-0.04em] text-gray-900">
                  위치 지정하기
                </h3>
                <p className="mt-1 break-keep text-sm leading-6 text-gray-500">
                  지도를 눌러 요메추 기준 위치를 직접 정하세요.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-500 transition-colors hover:border-primary hover:text-primary"
              >
                닫기
              </button>
            </div>

            <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-gray-50">
              <div ref={mapElementRef} className="h-72 w-full" />
            </div>

            <div className="mt-3 rounded-2xl bg-gray-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                SELECTED
              </p>
              <p className="mt-1 break-keep text-sm font-semibold text-gray-900">
                직접 지정 위치
              </p>
              <p className="mt-1 text-xs text-gray-500">{coordinateLabel}</p>
            </div>

            {loading ? (
              <p className="mt-3 text-sm text-gray-500">지도를 불러오는 중입니다.</p>
            ) : null}

            {error ? (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:border-primary hover:text-primary"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => onConfirm(selectedCoords)}
                disabled={loading}
                className="flex-1 rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                이 위치 사용
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
