"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const KAKAO_MAPS_SCRIPT_ID = "yomechu-kakao-sdk-maps";

type Coordinates = {
  lat: number;
  lng: number;
};

type LocationSelection = Coordinates & {
  label: string;
};

interface SearchPlaceResult {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  x: string;
  y: string;
}

interface YomechuLocationPickerModalProps {
  isOpen: boolean;
  initialCenter: Coordinates;
  initialLabel?: string | null;
  onClose: () => void;
  onConfirm: (selection: LocationSelection) => void;
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
  initialLabel,
  onClose,
  onConfirm,
}: YomechuLocationPickerModalProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const markerRef = useRef<kakao.maps.Marker | null>(null);
  const placesRef = useRef<kakao.maps.services.Places | null>(null);

  const [selectedCoords, setSelectedCoords] = useState<Coordinates>(initialCenter);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(initialLabel ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchPlaceResult[]>([]);

  const coordinateLabel = useMemo(
    () => `${selectedCoords.lat.toFixed(5)}, ${selectedCoords.lng.toFixed(5)}`,
    [selectedCoords]
  );

  const moveToSelection = useCallback(
    (coords: Coordinates, label?: string | null) => {
      const map = mapRef.current;
      const nextLabel = label ?? null;

      setSelectedCoords(coords);
      setSelectedLabel(nextLabel);

      if (!map) {
        return;
      }

      const latLng = new kakao.maps.LatLng(coords.lat, coords.lng);
      markerRef.current?.setMap(null);
      markerRef.current = new kakao.maps.Marker({
        position: latLng,
        map,
      });
      map.panTo(latLng);
    },
    []
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedCoords(initialCenter);
    setSelectedLabel(initialLabel ?? null);
    setQuery("");
    setSearchMessage(null);
    setSearchResults([]);
  }, [initialCenter, initialLabel, isOpen]);

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

        mapRef.current = map;
        markerRef.current = new kakao.maps.Marker({
          position: center,
          map,
        });
        placesRef.current = window.kakao?.maps?.services
          ? new kakao.maps.services.Places()
          : null;

        window.requestAnimationFrame(() => {
          map.setCenter(center);
        });

        kakao.maps.event.addListener(
          map,
          "click",
          (mouseEvent: { latLng?: kakao.maps.LatLng }) => {
            const latLng = mouseEvent?.latLng;
            if (!latLng) {
              return;
            }

            moveToSelection(
              {
                lat: latLng.getLat(),
                lng: latLng.getLng(),
              },
              null
            );
          }
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "지도를 불러오지 못했습니다."
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
      mapRef.current = null;
      placesRef.current = null;
    };
  }, [initialCenter, isOpen, moveToSelection]);

  const handleSearch = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const keyword = query.trim();
      if (!keyword) {
        setSearchResults([]);
        setSearchMessage("검색어를 입력해 주세요.");
        return;
      }

      setSearchLoading(true);
      setSearchMessage(null);
      setSearchResults([]);

      try {
        await ensureKakaoMapsLoaded();

        if (!window.kakao?.maps?.services) {
          throw new Error("장소 검색을 사용할 수 없습니다.");
        }

        const places = placesRef.current ?? new kakao.maps.services.Places();
        placesRef.current = places;

        const center = mapRef.current?.getCenter();
        const searchOptions = (
          center
            ? {
                x: center.getLng(),
                y: center.getLat(),
                size: 8,
              }
            : { size: 8 }
        ) as any;
        places.keywordSearch(
          keyword,
          (result, status) => {
            if (status === kakao.maps.services.Status.OK) {
              setSearchResults(result as SearchPlaceResult[]);
              setSearchMessage(null);
            } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
              setSearchResults([]);
              setSearchMessage("검색 결과가 없습니다.");
            } else {
              setSearchResults([]);
              setSearchMessage("검색 결과를 불러오지 못했습니다.");
            }

            setSearchLoading(false);
          },
          searchOptions
        );
      } catch (nextError) {
        setSearchLoading(false);
        setSearchMessage(
          nextError instanceof Error
            ? nextError.message
            : "검색을 실행하지 못했습니다."
        );
      }
    },
    [query]
  );

  const handleSelectSearchResult = useCallback(
    (place: SearchPlaceResult) => {
      const nextCoords = {
        lat: Number(place.y),
        lng: Number(place.x),
      };

      moveToSelection(nextCoords, place.place_name);
      setQuery(place.place_name);
      setSearchResults([]);
      setSearchMessage(null);
      mapRef.current?.setLevel(3);
    },
    [moveToSelection]
  );

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
                  지도를 직접 누르거나 검색으로 기준 위치를 정할 수 있습니다.
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

            <form onSubmit={handleSearch} className="mb-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="역명, 동네, 건물명으로 검색"
                  className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={searchLoading}
                  className="rounded-2xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {searchLoading ? "검색 중" : "검색"}
                </button>
              </div>
            </form>

            {searchResults.length > 0 ? (
              <div className="mb-3 max-h-40 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50">
                {searchResults.map((place) => {
                  const address = place.road_address_name || place.address_name;

                  return (
                    <button
                      key={`${place.id}-${place.x}-${place.y}`}
                      type="button"
                      onClick={() => handleSelectSearchResult(place)}
                      className="w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-white"
                    >
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {place.place_name}
                      </p>
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {address}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {searchMessage ? (
              <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                {searchMessage}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-gray-50">
              <div ref={mapElementRef} className="h-72 w-full" />
            </div>

            <div className="mt-3 rounded-2xl bg-gray-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                SELECTED
              </p>
              <p className="mt-1 break-keep text-sm font-semibold text-gray-900">
                {selectedLabel ?? "선택 위치"}
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
                onClick={() =>
                  onConfirm({
                    lat: selectedCoords.lat,
                    lng: selectedCoords.lng,
                    label: selectedLabel ?? "선택 위치",
                  })
                }
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
