"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  fetchKeywordDiscoveryStatus,
  getCrawlerBaseUrl,
  triggerKeywordDiscovery,
  type KeywordDiscoveryJobStatus,
  type KeywordDiscoverySummary,
} from "@/lib/crawler";

interface KeywordRow {
  id: string;
  keyword: string;
  category: string;
  is_active: boolean;
  last_checked: string | null;
  baseline_volume: number;
  created_at: string;
}

type DiscoveryStatus = "idle" | "loading" | "success" | "error";

const CATEGORIES = ["디저트", "음료", "식사", "간식"];
const KEYWORD_DISCOVERY_TIMEOUT_MS = 3 * 60 * 1000;
const KEYWORD_DISCOVERY_POLL_INTERVAL_MS = 2000;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatKeywordDiscoveryMessage(summary: KeywordDiscoverySummary | null) {
  if (!summary) {
    return "키워드 발굴이 완료되었습니다.";
  }

  if (summary.new_keywords > 0) {
    return `키워드 ${summary.new_keywords}개를 발굴했습니다.`;
  }

  return "새롭게 등록할 키워드는 없었습니다.";
}

export default function KeywordsTab() {
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>("idle");
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);
  const [discoverySummary, setDiscoverySummary] = useState<KeywordDiscoverySummary | null>(null);

  const fetchKeywords = async () => {
    const { data } = await supabase
      .from("keywords")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setKeywords(data as KeywordRow[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchKeywords();
  }, []);

  const addKeyword = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    await supabase.from("keywords").insert({
      keyword: trimmed,
      category: newCategory,
      is_active: true,
      baseline_volume: 0,
    });

    setNewKeyword("");
    await fetchKeywords();
  };

  const toggleActive = async (kw: KeywordRow) => {
    setKeywords((prev) =>
      prev.map((k) => (k.id === kw.id ? { ...k, is_active: !k.is_active } : k))
    );

    const { error } = await supabase
      .from("keywords")
      .update({ is_active: !kw.is_active })
      .eq("id", kw.id);

    if (error) {
      setKeywords((prev) =>
        prev.map((k) => (k.id === kw.id ? { ...k, is_active: kw.is_active } : k))
      );
    }
  };

  const deleteKeyword = async (id: string) => {
    await supabase.from("keywords").delete().eq("id", id);
    await fetchKeywords();
  };

  const waitForKeywordDiscoveryCompletion = async (): Promise<KeywordDiscoveryJobStatus> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < KEYWORD_DISCOVERY_TIMEOUT_MS) {
      const job = await fetchKeywordDiscoveryStatus();

      if (job.state === "completed") {
        return job;
      }

      if (job.state === "failed") {
        throw new Error(job.last_error || "키워드 발굴 실행에 실패했습니다.");
      }

      await delay(KEYWORD_DISCOVERY_POLL_INTERVAL_MS);
    }

    throw new Error("키워드 발굴 완료 확인이 지연되고 있습니다.");
  };

  const triggerDiscovery = async () => {
    const apiUrl = getCrawlerBaseUrl();
    if (!apiUrl) return;

    setDiscoveryStatus("loading");
    setDiscoveryMessage("키워드 발굴을 실행하고 있습니다...");
    setDiscoverySummary(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("관리자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
      }

      const result = await triggerKeywordDiscovery(accessToken);
      setDiscoveryMessage(
        result.accepted
          ? "키워드 발굴을 시작했습니다. 완료 여부를 확인하고 있습니다."
          : "이미 실행 중인 키워드 발굴을 확인하고 있습니다."
      );
      const job = await waitForKeywordDiscoveryCompletion();
      setDiscoveryStatus("success");
      setDiscoveryMessage(formatKeywordDiscoveryMessage(job.last_summary));
      setDiscoverySummary(job.last_summary);
      await fetchKeywords();
    } catch (error) {
      setDiscoveryStatus("error");
      setDiscoveryMessage(
        error instanceof Error ? error.message : "키워드 발굴 실행에 실패했습니다."
      );
      setTimeout(() => {
        setDiscoveryStatus("idle");
      }, 5000);
    }
  };

  if (loading) {
    return <p className="text-center text-gray-400 py-12">로딩 중...</p>;
  }

  const categoryColor: Record<string, string> = {
    디저트: "bg-pink-100 text-pink-600",
    음료: "bg-blue-100 text-blue-600",
    식사: "bg-orange-100 text-orange-600",
    간식: "bg-yellow-100 text-yellow-700",
  };

  const apiUrl = getCrawlerBaseUrl();

  return (
    <div>
      {/* 키워드 발굴 */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">키워드 자동 발굴</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              AI가 새로운 트렌드 키워드를 탐색하고 자동으로 등록합니다
            </p>
            {discoveryMessage && (
              <p
                className={`text-xs mt-2 ${
                  discoveryStatus === "error"
                    ? "text-red-500"
                    : discoveryStatus === "success"
                      ? "text-green-600"
                      : "text-gray-500"
                }`}
              >
                {discoveryMessage}
              </p>
            )}
          </div>
          <button
            onClick={triggerDiscovery}
            disabled={!apiUrl || discoveryStatus === "loading"}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 shrink-0 ${
              discoveryStatus === "success"
                ? "bg-green-500 text-white"
                : discoveryStatus === "error"
                  ? "bg-red-500 text-white"
                  : "bg-primary text-white hover:bg-purple-600"
            }`}
          >
            {discoveryStatus === "loading"
              ? "발굴 중..."
              : discoveryStatus === "success"
                ? "완료!"
                : discoveryStatus === "error"
                  ? "실패"
                  : !apiUrl
                    ? "API URL 미설정"
                    : "키워드 발굴"}
          </button>
        </div>

        {/* 발굴 결과 상세 */}
        {discoverySummary && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            {/* 수집 통계 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-gray-900">{discoverySummary.queries}</p>
                <p className="text-[11px] text-gray-400">메타 쿼리</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-gray-900">{discoverySummary.collected_posts}</p>
                <p className="text-[11px] text-gray-400">블로그 수집</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-gray-900">{discoverySummary.youtube_videos}</p>
                <p className="text-[11px] text-gray-400">유튜브 영상</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-gray-900">{discoverySummary.lead_candidates}</p>
                <p className="text-[11px] text-gray-400">후보 키워드</p>
              </div>
            </div>

            {/* AI 검토 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-purple-700">{discoverySummary.ai_reviewed}</p>
                <p className="text-[11px] text-purple-400">AI 검토</p>
              </div>
              <div className="bg-green-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-green-700">{discoverySummary.ai_accepted}</p>
                <p className="text-[11px] text-green-500">AI 수용</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-blue-700">{discoverySummary.ai_calls_used}</p>
                <p className="text-[11px] text-blue-400">AI 호출</p>
              </div>
              <div className={`rounded-lg p-2.5 text-center ${discoverySummary.budget_exhausted ? "bg-red-50" : "bg-gray-50"}`}>
                <p className={`text-lg font-bold ${discoverySummary.budget_exhausted ? "text-red-600" : "text-gray-900"}`}>
                  {discoverySummary.ai_calls_remaining}
                </p>
                <p className={`text-[11px] ${discoverySummary.budget_exhausted ? "text-red-400" : "text-gray-400"}`}>
                  잔여 예산{discoverySummary.budget_exhausted ? " (소진)" : ""}
                </p>
              </div>
            </div>

            {/* 발굴된 키워드 */}
            {discoverySummary.keywords.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">발굴된 키워드</p>
                <div className="flex flex-wrap gap-1.5">
                  {discoverySummary.keywords.map((kw) => (
                    <span key={kw} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 별칭 매핑 */}
            {discoverySummary.canonicalized_keywords.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                  별칭 매핑 ({discoverySummary.alias_matches}건)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {discoverySummary.canonicalized_keywords.map((c) => (
                    <span key={c} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* AI 그라운딩 */}
            {discoverySummary.ai_grounding_status === "used" && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">AI 그라운딩</p>
                {discoverySummary.ai_grounding_queries.length > 0 && (
                  <div className="mb-1">
                    <span className="text-[11px] text-gray-400">검색 쿼리: </span>
                    <span className="text-xs text-gray-600">
                      {discoverySummary.ai_grounding_queries.join(", ")}
                    </span>
                  </div>
                )}
                {discoverySummary.ai_grounding_sources.length > 0 && (
                  <div>
                    <span className="text-[11px] text-gray-400">참조 출처: </span>
                    <span className="text-xs text-gray-600">
                      {discoverySummary.ai_grounding_sources.join(", ")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* AI 거절/보류 상세 */}
            {discoverySummary.ai_rejected_details.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">AI 거절 키워드</p>
                <div className="bg-red-50 rounded-lg p-2.5 space-y-1">
                  {discoverySummary.ai_rejected_details.map((detail, i) => (
                    <p key={i} className="text-xs text-red-600 break-all">{detail}</p>
                  ))}
                </div>
              </div>
            )}

            {discoverySummary.ai_review_details.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">신뢰도 미달 (보류)</p>
                <div className="bg-yellow-50 rounded-lg p-2.5 space-y-1">
                  {discoverySummary.ai_review_details.map((detail, i) => (
                    <p key={i} className="text-xs text-yellow-700 break-all">{detail}</p>
                  ))}
                </div>
              </div>
            )}

            {discoverySummary.ai_fallback_details.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">AI 배치 실패</p>
                <div className="bg-orange-50 rounded-lg p-2.5 space-y-1">
                  {discoverySummary.ai_fallback_details.map((detail, i) => (
                    <p key={i} className="text-xs text-orange-600 break-all">{detail}</p>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setDiscoverySummary(null)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              결과 닫기
            </button>
          </div>
        )}
      </div>

      {/* 추가 폼 */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            placeholder="새 키워드 입력..."
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={addKeyword}
            disabled={!newKeyword.trim()}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
          >
            추가
          </button>
        </div>
      </div>

      {/* 키워드 목록 */}
      <div className="flex flex-col gap-2">
        {keywords.length === 0 ? (
          <p className="text-center text-gray-400 py-12">등록된 키워드가 없습니다</p>
        ) : (
          keywords.map((kw) => (
            <div
              key={kw.id}
              className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-sm text-gray-900">{kw.keyword}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    categoryColor[kw.category] || "bg-gray-100 text-gray-500"
                  }`}
                >
                  {kw.category}
                </span>
                {kw.last_checked && (
                  <span className="text-xs text-gray-300">
                    {new Date(kw.last_checked).toLocaleDateString("ko-KR")}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* 토글 스위치 */}
                <button
                  onClick={() => toggleActive(kw)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    kw.is_active ? "bg-green-500" : "bg-gray-300"
                  }`}
                  title={kw.is_active ? "활성" : "비활성"}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      kw.is_active ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>

                <button
                  onClick={() => deleteKeyword(kw.id)}
                  className="px-2 py-1 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors"
                >
                  삭제
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
