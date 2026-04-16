"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type QueueItemType = "keyword" | "trend";
type QueueStatus = "pending" | "approved" | "rejected" | "applied";
type FilterStatus = QueueStatus | "all";
type NoticeTone = "idle" | "success" | "error";

interface QueuePayload {
  category?: string | null;
  category_hint?: string | null;
  canonical_keyword?: string | null;
  frequency?: number | null;
  food_score?: number | null;
  food_ratio?: number | null;
  lead_score?: number | null;
  lead_sources?: string[];
  raw_terms?: string[];
  evidence_snippets?: string[];
  score?: number | null;
  acceleration?: number | null;
  novelty_lift?: number | null;
  score_breakdown?: Record<string, number>;
  existing_status?: string | null;
  grounding_queries?: string[];
  grounding_sources?: string[];
}

interface QueueRow {
  id: string;
  source_job: string;
  item_type: QueueItemType;
  candidate_key: string;
  candidate_name: string;
  category: string | null;
  confidence: number;
  ai_verdict: string;
  reason: string | null;
  model: string | null;
  trend_id: string | null;
  trigger: string | null;
  payload: QueuePayload | null;
  status: QueueStatus;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const ITEM_TYPE_LABELS: Record<QueueItemType, string> = {
  keyword: "키워드",
  trend: "트렌드",
};

const STATUS_LABELS: Record<FilterStatus, string> = {
  all: "전체",
  pending: "대기",
  approved: "승인",
  rejected: "거절",
  applied: "반영",
};

const STATUS_STYLES: Record<QueueStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
  applied: "bg-green-100 text-green-700",
};

const VERDICT_STYLES: Record<string, string> = {
  accept: "bg-green-100 text-green-700",
  reject: "bg-red-100 text-red-700",
  review: "bg-yellow-100 text-yellow-700",
};

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
  popularity: "인기",
  rank: "랭크",
  instagram: "IG",
};

function cleanDisplayKeyword(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getScoreBreakdown(value: unknown): Record<string, number> {
  const raw = asRecord(value);
  return Object.entries(raw).reduce<Record<string, number>>((acc, [key, entry]) => {
    if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
      acc[key] = entry;
    }
    return acc;
  }, {});
}

function resolveKeywordCategory(row: QueueRow): string {
  return (
    row.category ||
    getString(row.payload?.category) ||
    getString(row.payload?.category_hint) ||
    "기타"
  );
}

function resolveTrendStatus(existingStatus: string | null): string {
  if (existingStatus === "active" || existingStatus === "rising") {
    return existingStatus;
  }
  return "watchlist";
}

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).filter(([, value]) => value > 0);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  return (
    <div className="mt-3 text-xs">
      <div className="flex h-2 overflow-hidden rounded-full">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className={SCORE_COLORS[key] ?? "bg-gray-300"}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${SCORE_LABELS[key] ?? key}: ${value}`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-gray-400">
        {entries.map(([key, value]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${SCORE_COLORS[key] ?? "bg-gray-300"}`} />
            {SCORE_LABELS[key] ?? key} {value}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AiReviewQueueTab() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<QueueItemType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("idle");

  const fetchRows = async () => {
    setLoading(true);
    let query = supabase
      .from("ai_review_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (itemTypeFilter !== "all") {
      query = query.eq("item_type", itemTypeFilter);
    }

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const trimmedSearch = search.trim().replace(/,/g, " ");
    if (trimmedSearch) {
      query = query.or(
        `candidate_name.ilike.%${trimmedSearch}%,reason.ilike.%${trimmedSearch}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      setNoticeTone("error");
      setNotice(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as QueueRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void fetchRows();
  }, [itemTypeFilter, statusFilter]);

  const stats = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status === "pending") acc.pending += 1;
        if (row.item_type === "keyword") acc.keywords += 1;
        if (row.item_type === "trend") acc.trends += 1;
        return acc;
      },
      { total: 0, pending: 0, keywords: 0, trends: 0 }
    );
  }, [rows]);

  const updateQueueStatus = async (rowId: string, status: QueueStatus) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("ai_review_queue")
      .update({
        status,
        resolved_at: status === "pending" ? null : now,
        updated_at: now,
      })
      .eq("id", rowId);

    if (error) {
      throw error;
    }
  };

  const applyKeyword = async (row: QueueRow, approvedName = row.candidate_name) => {
    const keywordName = cleanDisplayKeyword(approvedName);
    const existingKeyword = await supabase
      .from("keywords")
      .select("source")
      .eq("keyword", keywordName)
      .maybeSingle();
    if (existingKeyword.error) {
      throw existingKeyword.error;
    }

    const { error } = await supabase.from("keywords").upsert(
      {
        keyword: keywordName,
        category: resolveKeywordCategory(row),
        is_active: true,
        source: existingKeyword.data?.source === "manual" ? "manual" : "discovered",
        baseline_volume: 0,
      },
      {
        onConflict: "keyword",
      }
    );

    if (error) {
      throw error;
    }
  };

  const applyTrend = async (row: QueueRow, approvedName = row.candidate_name) => {
    const payload = asRecord(row.payload);
    const now = new Date().toISOString();
    const breakdown = getScoreBreakdown(payload.score_breakdown);
    const trendName = cleanDisplayKeyword(approvedName);
    const existingNamedTrend =
      row.trend_id && trendName === cleanDisplayKeyword(row.candidate_name)
        ? null
        : await supabase
            .from("trends")
            .select("id, status")
            .eq("name", trendName)
            .limit(1)
            .maybeSingle();

    if (existingNamedTrend?.error) {
      throw existingNamedTrend.error;
    }

    const existingStatus =
      getString(payload.existing_status) ??
      existingNamedTrend?.data?.status ??
      null;

    const trendData = {
      name: trendName,
      category: resolveKeywordCategory(row),
      status: resolveTrendStatus(existingStatus),
      detected_at: now,
      peak_score: getNumber(payload.score) ?? 0,
      score_breakdown: breakdown,
      ai_verdict: row.ai_verdict,
      ai_reason: row.reason,
      ai_confidence: row.confidence,
      ai_reviewed_at: now,
      ai_model: row.model,
      ai_grounding_sources: getStringArray(payload.grounding_sources),
      ai_consecutive_accepts: 0,
      ai_consecutive_rejects: 0,
    };

    if (row.trend_id && (!existingNamedTrend?.data?.id || existingNamedTrend.data.id === row.trend_id)) {
      const { error } = await supabase
        .from("trends")
        .update(trendData)
        .eq("id", row.trend_id);

      if (error) {
        throw error;
      }
      return;
    }

    if (existingNamedTrend?.data?.id) {
      const { error } = await supabase
        .from("trends")
        .update(trendData)
        .eq("id", existingNamedTrend.data.id);

      if (error) {
        throw error;
      }
      return;
    }

    const { error } = await supabase.from("trends").insert(trendData);
    if (error) {
      throw error;
    }
  };

  const approveRow = async (row: QueueRow, approvedName = row.candidate_name) => {
    const targetName = cleanDisplayKeyword(approvedName);
    setBusyId(row.id);
    setNotice(null);
    setNoticeTone("idle");

    try {
      if (row.item_type === "keyword") {
        await applyKeyword(row, targetName);
      } else {
        await applyTrend(row, targetName);
      }

      await updateQueueStatus(row.id, "applied");
      setNoticeTone("success");
      if (targetName !== cleanDisplayKeyword(row.candidate_name)) {
        setNotice(`${row.candidate_name} 항목을 ${targetName} 대표명으로 반영했습니다.`);
      } else {
        setNotice(
          row.item_type === "keyword"
            ? `${row.candidate_name} 키워드를 반영했습니다.`
            : `${row.candidate_name} 트렌드를 반영했습니다.`
        );
      }
      await fetchRows();
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "반영 중 오류가 발생했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const rejectRow = async (row: QueueRow) => {
    setBusyId(row.id);
    setNotice(null);
    setNoticeTone("idle");

    try {
      await updateQueueStatus(row.id, "rejected");
      setNoticeTone("success");
      setNotice(`${row.candidate_name} 항목을 거절했습니다.`);
      await fetchRows();
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "거절 처리 중 오류가 발생했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">조회 항목</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">대기 중</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">{stats.pending}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">키워드</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.keywords}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">트렌드</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.trends}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void fetchRows()}
            aria-label="AI 검토 큐 검색"
            placeholder="후보명 또는 사유 검색"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <select
            value={itemTypeFilter}
            onChange={(event) => setItemTypeFilter(event.target.value as QueueItemType | "all")}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            <option value="all">전체 타입</option>
            <option value="keyword">키워드</option>
            <option value="trend">트렌드</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void fetchRows()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600"
          >
            새로고침
          </button>
        </div>

        {notice && (
          <p
            className={`mt-3 text-sm ${
              noticeTone === "error" ? "text-red-500" : "text-green-600"
            }`}
          >
            {notice}
          </p>
        )}
      </div>

      {loading ? (
        <p className="py-12 text-center text-gray-400">로딩 중...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          표시할 AI 보류 항목이 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((row) => {
            const payload = asRecord(row.payload);
            const scoreBreakdown = getScoreBreakdown(payload.score_breakdown);
            const rawTerms = getStringArray(payload.raw_terms).slice(0, 5);
            const leadSources = getStringArray(payload.lead_sources).slice(0, 3);
            const evidenceSnippets = getStringArray(payload.evidence_snippets).slice(0, 2);
            const groundingSources = getStringArray(payload.grounding_sources).slice(0, 3);
            const canonicalKeyword = getString(payload.canonical_keyword);
            const hasCanonicalApproval =
              canonicalKeyword !== null &&
              cleanDisplayKeyword(canonicalKeyword) !== cleanDisplayKeyword(row.candidate_name);
            const isPending = row.status === "pending";

            return (
              <div key={row.id} className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {row.candidate_name}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        {ITEM_TYPE_LABELS[row.item_type]}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          VERDICT_STYLES[row.ai_verdict] ?? "bg-gray-100 text-gray-500"
                        }`}
                      >
                        AI {row.ai_verdict}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[row.status]
                        }`}
                      >
                        {STATUS_LABELS[row.status]}
                      </span>
                      <span className="text-xs text-gray-400">
                        신뢰도 {(row.confidence * 100).toFixed(0)}%
                      </span>
                      {row.category && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {row.category}
                        </span>
                      )}
                    </div>

                    {row.reason && (
                      <p className="mt-2 text-sm leading-relaxed text-gray-600">{row.reason}</p>
                    )}

                    {scoreBreakdown && <ScoreBreakdown breakdown={scoreBreakdown} />}

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                      <span>{row.source_job}</span>
                      {row.trigger && <span>trigger {row.trigger}</span>}
                      {getNumber(payload.frequency) !== null && (
                        <span>빈도 {getNumber(payload.frequency)}</span>
                      )}
                      {getNumber(payload.food_score) !== null && (
                        <span>food score {getNumber(payload.food_score)?.toFixed(1)}</span>
                      )}
                      {getNumber(payload.score) !== null && (
                        <span>총점 {getNumber(payload.score)?.toFixed(0)}</span>
                      )}
                      {getNumber(payload.acceleration) !== null && (
                        <span>가속도 {getNumber(payload.acceleration)?.toFixed(1)}</span>
                      )}
                      {getNumber(payload.novelty_lift) !== null && (
                        <span>novelty {getNumber(payload.novelty_lift)?.toFixed(1)}%</span>
                      )}
                      {getString(payload.existing_status) && (
                        <span>기존 상태 {getString(payload.existing_status)}</span>
                      )}
                      {row.model && <span>{row.model}</span>}
                      <span>
                        {new Date(row.created_at).toLocaleString("ko-KR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    {canonicalKeyword && canonicalKeyword !== row.candidate_name && (
                      <p className="mt-2 text-xs text-blue-600">
                        AI 대표명 제안: {canonicalKeyword}
                      </p>
                    )}

                    {rawTerms.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {rawTerms.map((term) => (
                          <span
                            key={term}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                          >
                            {term}
                          </span>
                        ))}
                      </div>
                    )}

                    {leadSources.length > 0 && (
                      <p className="mt-2 text-xs text-gray-400">
                        출처: {leadSources.join(", ")}
                      </p>
                    )}

                    {groundingSources.length > 0 && (
                      <p className="mt-2 text-xs text-gray-400">
                        grounding: {groundingSources.join(", ")}
                      </p>
                    )}

                    {evidenceSnippets.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {evidenceSnippets.map((snippet, index) => (
                          <p key={`${row.id}-snippet-${index}`} className="text-xs text-gray-500">
                            {snippet}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  {isPending && (
                    <div className="flex flex-shrink-0 flex-col gap-2">
                      {hasCanonicalApproval && canonicalKeyword && (
                        <p className="max-w-[220px] rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
                          대표명 판단은 AI/동의어 탭에서 묶기, 분리, 뒤집기로 처리합니다.
                        </p>
                      )}
                      <button
                        onClick={() => void approveRow(row)}
                        disabled={busyId === row.id}
                        className="rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
                      >
                        {busyId === row.id ? "처리 중..." : "승인"}
                      </button>
                      <button
                        onClick={() => void rejectRow(row)}
                        disabled={busyId === row.id}
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                      >
                        거절
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
