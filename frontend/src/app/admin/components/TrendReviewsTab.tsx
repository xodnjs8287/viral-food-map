"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface ReviewRow {
  id: string;
  keyword: string;
  verdict: string;
  confidence: number;
  reason: string | null;
  category: string | null;
  model: string | null;
  grounding_used: boolean;
  grounding_sources: string[];
  trigger: string | null;
  score: number | null;
  acceleration: number | null;
  novelty_lift: number | null;
  score_breakdown: Record<string, number> | null;
  created_at: string;
}

const SCORE_COLORS: Record<string, string> = {
  acceleration: "bg-red-400",
  novelty_lift: "bg-orange-400",
  blog_freshness: "bg-blue-400",
  popularity: "bg-purple-400",
  rank: "bg-gray-400",
  instagram: "bg-pink-400",
};

const SCORE_LABELS: Record<string, string> = {
  acceleration: "가속도",
  novelty_lift: "신규성",
  blog_freshness: "블로그",
  popularity: "인기도",
  rank: "랭크",
  instagram: "IG",
};

const VERDICT_STYLES: Record<string, string> = {
  accept: "bg-green-100 text-green-700",
  reject: "bg-red-100 text-red-700",
  review: "bg-yellow-100 text-yellow-700",
};

export default function TrendReviewsTab() {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<string>("all");

  const fetchReviews = async () => {
    setLoading(true);
    let query = supabase
      .from("trend_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (keyword.trim()) {
      query = query.ilike("keyword", `%${keyword.trim()}%`);
    }
    if (verdictFilter !== "all") {
      query = query.eq("verdict", verdictFilter);
    }

    const { data } = await query;
    if (data) setReviews(data as ReviewRow[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchReviews();
  }, [verdictFilter]);

  return (
    <div>
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchReviews()}
            aria-label="트렌드 리뷰 키워드 검색"
            placeholder="키워드 검색..."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
        </div>
        <select
          value={verdictFilter}
          onChange={(e) => setVerdictFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
        >
          <option value="all">전체 판정</option>
          <option value="accept">accept</option>
          <option value="reject">reject</option>
          <option value="review">review</option>
        </select>
        <button
          onClick={fetchReviews}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors"
        >
          검색
        </button>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-12">로딩 중...</p>
      ) : reviews.length === 0 ? (
        <p className="text-center text-gray-400 py-12">리뷰 기록이 없습니다</p>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-xl p-4 border border-gray-100"
            >
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-sm text-gray-900">
                  {r.keyword}
                </span>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    VERDICT_STYLES[r.verdict] ?? "bg-gray-100 text-gray-500"
                  }`}
                >
                  {r.verdict}
                </span>
                <span className="text-xs text-gray-400">
                  신뢰도 {(r.confidence * 100).toFixed(0)}%
                </span>
                {r.category && (
                  <span className="text-xs rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                    {r.category}
                  </span>
                )}
              </div>

              {r.reason && (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  {r.reason}
                </p>
              )}

              {r.score_breakdown && Object.values(r.score_breakdown).some((v) => v > 0) && (
                <div className="mt-2 text-xs">
                  <div className="flex h-2 rounded-full overflow-hidden">
                    {Object.entries(r.score_breakdown)
                      .filter(([, v]) => v > 0)
                      .map(([key, value]) => (
                        <div
                          key={key}
                          className={SCORE_COLORS[key] ?? "bg-gray-300"}
                          style={{ width: `${(value / 100) * 100}%` }}
                          title={`${SCORE_LABELS[key] ?? key}: ${value}`}
                        />
                      ))}
                  </div>
                  <div className="flex gap-2 mt-1 flex-wrap text-gray-400">
                    {Object.entries(r.score_breakdown)
                      .filter(([, v]) => v > 0)
                      .map(([key, value]) => (
                        <span key={key} className="flex items-center gap-1">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${SCORE_COLORS[key] ?? "bg-gray-300"}`} />
                          {SCORE_LABELS[key] ?? key} {value}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                {r.score != null && <span>총점 {r.score.toFixed(0)}</span>}
                {r.acceleration != null && (
                  <span>가속도 {r.acceleration.toFixed(1)}</span>
                )}
                {r.novelty_lift != null && (
                  <span>novelty {r.novelty_lift.toFixed(1)}%</span>
                )}
                {r.grounding_used && (
                  <span className="text-blue-500">검색 근거 사용</span>
                )}
                {r.model && <span>{r.model}</span>}
                <span>
                  {new Date(r.created_at).toLocaleString("ko-KR", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              {r.grounding_sources && r.grounding_sources.length > 0 && (
                <div className="mt-2 text-xs text-gray-400">
                  <span className="font-medium">출처:</span>{" "}
                  {r.grounding_sources.slice(0, 3).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
