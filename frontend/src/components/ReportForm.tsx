"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Trend } from "@/lib/types";

function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!window.kakao?.maps?.services) {
      resolve(null);
      return;
    }
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        resolve(null);
      }
    });
  });
}

export default function ReportForm() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [trendId, setTrendId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trendId || !storeName || !address) return;

    setSubmitting(true);

    // 1. 주소 → 좌표 변환
    const coords = await geocodeAddress(address);

    // 2. reports 테이블에 제보 기록
    await supabase.from("reports").insert({
      trend_id: trendId,
      store_name: storeName,
      address,
      lat: coords?.lat || null,
      lng: coords?.lng || null,
      note: note || null,
      status: "pending",
    });

    setSubmitting(false);
    setSubmitted(true);
    setStoreName("");
    setAddress("");
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          매장 이름
        </label>
        <input
          type="text"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          placeholder="예: 몬트쿠키 김포본점"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          주소
        </label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="예: 서울시 강남구 역삼동 123"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          required
        />
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
        disabled={submitting}
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
