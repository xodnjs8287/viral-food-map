"use client";

import { useState, useEffect, useRef } from "react";
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

function searchPlaces(keyword: string): Promise<PlaceResult[]> {
  return new Promise(async (resolve) => {
    if (!keyword.trim()) {
      resolve([]);
      return;
    }
    await ensureKakaoLoaded();
    if (!window.kakao?.maps?.services) {
      resolve([]);
      return;
    }
    const ps = new kakao.maps.services.Places();
    ps.keywordSearch(
      keyword,
      (result, status) => {
        if (status === kakao.maps.services.Status.OK) {
          resolve(result.slice(0, 5) as PlaceResult[]);
        } else {
          resolve([]);
        }
      },
      { size: 5, category_group_code: "FD6,CE7" }
    );
  });
}

export default function ReportForm() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [trendId, setTrendId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    supabase
      .from("trends")
      .select("id, name, category, status")
      .in("status", ["rising", "active"])
      .order("peak_score", { ascending: false })
      .then(({ data }) => {
        if (data) setTrends(data as Trend[]);
      });
  }, []);

  useEffect(() => {
    if (selected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const places = await searchPlaces(query);
      setResults(places);
      setShowResults(true);
    }, 300);
  }, [query, selected]);

  const handleSelect = (place: PlaceResult) => {
    setSelected(place);
    setQuery(place.place_name);
    setResults([]);
    setShowResults(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trendId || !selected) return;

    setSubmitting(true);

    const address = selected.road_address_name || selected.address_name;
    await supabase.from("reports").insert({
      trend_id: trendId,
      store_name: selected.place_name,
      address,
      lat: parseFloat(selected.y),
      lng: parseFloat(selected.x),
      note: note || null,
      status: "pending",
    });

    setSubmitting(false);
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
        <select
          value={trendId}
          onChange={(e) => setTrendId(e.target.value)}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          required
        >
          <option value="">트렌드 선택</option>
          {trends.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
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
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            {results.map((place, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(place)}
                className="w-full px-4 py-3 text-left hover:bg-purple-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <p className="text-sm font-medium text-gray-900">
                  {place.place_name}
                </p>
                <p className="text-xs text-gray-400">
                  {place.road_address_name || place.address_name}
                </p>
              </button>
            ))}
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
        disabled={submitting || !selected}
        className="w-full bg-primary text-white font-semibold py-3 rounded-xl transition-colors hover:bg-purple-600 disabled:opacity-50"
      >
        {submitting ? "제보 중..." : "제보하기"}
      </button>

      {submitted && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-up">
          제보가 접수되었습니다! 관리자 확인 후 반영됩니다
        </div>
      )}
    </form>
  );
}
