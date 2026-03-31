"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Trend } from "@/lib/types";

interface PlaceResult {
  place_name: string;
  road_address_name: string;
  address_name: string;
  x: string;
  y: string;
  phone: string;
}

function ensureKakaoLoaded(): Promise<void> {
  return new Promise((resolve) => {
    if (window.kakao?.maps?.services) {
      resolve();
      return;
    }
    if (window.kakao?.maps) {
      kakao.maps.load(() => resolve());
    } else {
      resolve();
    }
  });
}

interface ReportFormProps {
  initialTrends: Trend[];
}

export default function ReportForm({ initialTrends }: ReportFormProps) {
  const [trends, setTrends] = useState<Trend[]>(initialTrends);
  const [trendId, setTrendId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedStoreName, setSubmittedStoreName] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(initialTrends.length === 0);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout>();
  const paginationRef = useRef<kakao.maps.services.PlacesPagination | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchTrends = useCallback(async () => {
    setTrendsLoading(true);
    setTrendsError(null);

    const { data, error } = await supabase
      .from("trends")
      .select("id, name, category, status")
      .in("status", ["rising", "active"])
      .order("peak_score", { ascending: false });

    if (error) {
      setTrendsError("트렌드 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setTrendsLoading(false);
      return;
    }

    setTrends((data as Trend[]) ?? []);
    setTrendsLoading(false);
  }, []);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  const isFirstSearchRef = useRef(true);

  const startSearch = useCallback(async (keyword: string) => {
    await ensureKakaoLoaded();
    if (!window.kakao?.maps?.services) return;

    isFirstSearchRef.current = true;
    const ps = new kakao.maps.services.Places();
    ps.keywordSearch(
      keyword,
      (result, status, pagination) => {
        if (status === kakao.maps.services.Status.OK) {
          if (isFirstSearchRef.current) {
            setResults(result as PlaceResult[]);
            isFirstSearchRef.current = false;
          } else {
            setResults((prev) => [...prev, ...(result as PlaceResult[])]);
          }
          paginationRef.current = pagination;
          setShowResults(true);
        }
        setLoadingMore(false);
      },
      { size: 15 }
    );
  }, []);

  // 검색 디바운스
  useEffect(() => {
    if (selected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) {
      setResults([]);
      paginationRef.current = null;
      return;
    }
    debounceRef.current = setTimeout(() => startSearch(query), 300);
  }, [query, selected, startSearch]);

  const handleDropdownScroll = useCallback(() => {
    const el = dropdownRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
      const pg = paginationRef.current;
      if (pg && pg.hasNextPage && !loadingMore) {
        setLoadingMore(true);
        pg.nextPage();
      }
    }
  }, [loadingMore]);

  const handleSelect = (place: PlaceResult) => {
    setSelected(place);
    setQuery(place.place_name);
    setResults([]);
    setShowResults(false);
    paginationRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trendId || !selected) return;

    setSubmitting(true);

    const address = selected.road_address_name || selected.address_name;
    const trendName = trends.find((t) => t.id === trendId)?.name ?? "";
    const storeName = selected.place_name;

    const { data } = await supabase
      .from("reports")
      .insert({
        trend_id: trendId,
        store_name: storeName,
        address,
        lat: parseFloat(selected.y),
        lng: parseFloat(selected.x),
        note: note || null,
        status: "pending",
      })
      .select("id");

    if (data?.[0]?.id) {
      const entry = {
        id: data[0].id,
        store_name: storeName,
        trend_name: trendName,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      const prev = JSON.parse(localStorage.getItem("my_reports") ?? "[]");
      localStorage.setItem(
        "my_reports",
        JSON.stringify([entry, ...prev].slice(0, 20))
      );
    }

    setSubmitting(false);
    setSubmittedStoreName(storeName);
    setSubmitted(true);
    setQuery("");
    setSelected(null);
    setNote("");
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          어떤 음식인가요?
        </label>
        <div className="relative">
          <select
            value={trendId}
            onChange={(e) => setTrendId(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 appearance-none disabled:bg-gray-50 disabled:text-gray-400"
            disabled={trendsLoading || !!trendsError || trends.length === 0}
            required
          >
            <option value="">
              {trendsLoading
                ? "트렌드 불러오는 중..."
                : trendsError
                  ? "트렌드 로드 실패"
                  : trends.length === 0
                    ? "등록된 트렌드 없음"
                    : "트렌드 선택"}
            </option>
            {trends.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <svg className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        {trendsLoading && (
          <p className="mt-2 text-xs text-gray-500">
            제보 가능한 트렌드 목록을 가져오고 있습니다.
          </p>
        )}
        {trendsError && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-xs text-red-700">{trendsError}</p>
            <button
              type="button"
              onClick={fetchTrends}
              className="flex-shrink-0 rounded-lg bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white"
            >
              다시 시도
            </button>
          </div>
        )}
        {!trendsLoading && !trendsError && trends.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">
            현재 제보 가능한 활성 트렌드가 없습니다.
          </p>
        )}
      </div>

      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          매장 검색
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) setSelected(null);
          }}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder="매장 이름을 검색하세요"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          required
        />

        {showResults && results.length > 0 && (
          <div
            ref={dropdownRef}
            onScroll={handleDropdownScroll}
            className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-y-auto"
          >
            {results.map((place, i) => {
              const addr = place.road_address_name || place.address_name;
              const region = addr.split(" ").slice(0, 2).join(" ");
              return (
                <button
                  key={`${place.place_name}-${place.x}-${i}`}
                  type="button"
                  onClick={() => handleSelect(place)}
                  className="w-full px-4 py-3 text-left hover:bg-purple-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {place.place_name}
                    </p>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                      {region}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{addr}</p>
                </button>
              );
            })}
            {loadingMore && (
              <div className="px-4 py-3 text-center text-xs text-gray-400">
                검색 중...
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="mt-2 bg-purple-50 rounded-lg px-3 py-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {selected.place_name}
              </p>
              <p className="text-xs text-gray-500">
                {selected.road_address_name || selected.address_name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setQuery("");
              }}
              className="text-gray-400 hover:text-gray-600 text-xs"
            >
              변경
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          메모 (선택)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="추가 정보가 있다면 적어주세요"
          rows={2}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={
          submitting ||
          !selected ||
          !trendId ||
          trendsLoading ||
          !!trendsError ||
          trends.length === 0
        }
        className="w-full bg-primary text-white font-semibold py-3 rounded-xl transition-colors hover:bg-purple-600 disabled:opacity-50"
      >
        {submitting ? "제보 중..." : "제보하기"}
      </button>

      {submitted && (
        <div className="fixed bottom-nav-floating-offset left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up whitespace-nowrap">
          ✅ &apos;{submittedStoreName}&apos; 제보 완료! 24시간 내 지도에 반영돼요
        </div>
      )}
    </form>
  );
}
