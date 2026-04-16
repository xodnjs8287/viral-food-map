"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCrawlerHealth, type CrawlerHealthResponse } from "@/lib/crawler";
import { supabase } from "@/lib/supabase";

interface KeywordAliasRow {
  id: string;
  alias: string;
  canonical_keyword: string;
  confidence: number | null;
  source_job: string;
  decision_type: string | null;
  last_seen_at: string;
  created_at: string;
}

interface AIAutomationUsageRow {
  id: string;
  usage_date: string;
  job_name: string;
  trigger: string;
  created_at: string;
}

type QueueItemType = "keyword" | "trend";
type SaveStatus = "idle" | "loading" | "success" | "error";
type CanonicalDecision = "merge" | "separate" | "reverse";

interface QueuePayload {
  canonical_keyword?: string | null;
  raw_terms?: string[];
}

interface QueueRow {
  id: string;
  source_job: string;
  item_type: QueueItemType;
  candidate_key: string;
  candidate_name: string;
  confidence: number | null;
  reason: string | null;
  model: string | null;
  trigger: string | null;
  payload: QueuePayload | null;
  created_at: string;
}

const ITEM_TYPE_LABELS: Record<QueueItemType, string> = {
  keyword: "키워드",
  trend: "트렌드",
};

function cleanDisplayKeyword(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKeyword(value: string) {
  return cleanDisplayKeyword(value)
    .toLowerCase()
    .replace(/[^0-9a-zA-Z\uAC00-\uD7A3]+/g, "");
}

function buildAliasPairKey(termA: string, termB: string) {
  const normalizedTerms = Array.from(
    new Set([normalizeKeyword(termA), normalizeKeyword(termB)].filter(Boolean))
  ).sort();
  if (normalizedTerms.length !== 2) {
    return null;
  }
  return normalizedTerms.join("::");
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : [];
}

function getTodaySeoulDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function matchesAliasQuery(row: KeywordAliasRow, trimmedQuery: string) {
  if (!trimmedQuery) {
    return true;
  }

  return (
    row.alias.toLowerCase().includes(trimmedQuery) ||
    row.canonical_keyword.toLowerCase().includes(trimmedQuery)
  );
}

function getDecisionBadge(decisionType: string | null) {
  if (decisionType === "merge") {
    return {
      label: "묶기 저장",
      className: "bg-green-50 text-green-700",
    };
  }

  if (decisionType === "separate") {
    return {
      label: "분리 저장",
      className: "bg-orange-50 text-orange-700",
    };
  }

  return null;
}

async function saveAliasDecision(
  termA: string,
  termB: string,
  decision: CanonicalDecision,
  confidence: number | null,
  sourceJob = "admin"
) {
  const cleanedA = cleanDisplayKeyword(termA);
  const cleanedB = cleanDisplayKeyword(termB);
  const normA = normalizeKeyword(cleanedA);
  const normB = normalizeKeyword(cleanedB);

  if (!normA || !normB || normA === normB) {
    throw new Error("정규화 가능한 서로 다른 키워드를 입력해 주세요.");
  }

  // 기존 쌍 삭제 (양방향)
  const [r1, r2] = await Promise.all([
    supabase
      .from("keyword_aliases")
      .delete()
      .eq("alias_normalized", normA)
      .eq("canonical_normalized", normB),
    supabase
      .from("keyword_aliases")
      .delete()
      .eq("alias_normalized", normB)
      .eq("canonical_normalized", normA),
  ]);
  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;

  const now = new Date().toISOString();

  if (decision === "separate") {
    const { error } = await supabase.from("keyword_aliases").insert({
      alias: cleanedA,
      alias_normalized: normA,
      canonical_keyword: cleanedB,
      canonical_normalized: normB,
      decision_type: "separate",
      confidence,
      source_job: sourceJob,
      last_seen_at: now,
    });
    if (error) throw error;
    return;
  }

  // merge 또는 reverse
  const [alias, canonical] =
    decision === "merge" ? [cleanedA, cleanedB] : [cleanedB, cleanedA];
  const aliasNorm = normalizeKeyword(alias);
  const canonicalNorm = normalizeKeyword(canonical);

  // 이 alias가 다른 canonical을 가리키던 기존 행 삭제
  const { error: clearError } = await supabase
    .from("keyword_aliases")
    .delete()
    .eq("alias_normalized", aliasNorm)
    .neq("canonical_normalized", canonicalNorm);
  if (clearError) throw clearError;

  const { error } = await supabase.from("keyword_aliases").upsert(
    {
      alias,
      alias_normalized: aliasNorm,
      canonical_keyword: canonical,
      canonical_normalized: canonicalNorm,
      decision_type: "merge",
      confidence,
      source_job: sourceJob,
      last_seen_at: now,
    },
    { onConflict: "alias_normalized,canonical_normalized" }
  );
  if (error) throw error;
}

export default function AiAliasesTab() {
  const [aliases, setAliases] = useState<KeywordAliasRow[]>([]);
  const [pendingCanonicalRows, setPendingCanonicalRows] = useState<QueueRow[]>([]);
  const [usageRows, setUsageRows] = useState<AIAutomationUsageRow[]>([]);
  const [health, setHealth] = useState<CrawlerHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [aliasInput, setAliasInput] = useState("");
  const [canonicalInput, setCanonicalInput] = useState("");
  const [confidenceInput, setConfidenceInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<SaveStatus>("idle");
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const today = getTodaySeoulDate();
    const [aliasesResult, usageResult, pendingResult] =
      await Promise.allSettled([
        supabase
          .from("keyword_aliases")
          .select(
            "id, alias, canonical_keyword, confidence, source_job, decision_type, last_seen_at, created_at"
          )
          .order("last_seen_at", { ascending: false })
          .limit(200),
        supabase
          .from("ai_automation_usage")
          .select("id, usage_date, job_name, trigger, created_at")
          .eq("usage_date", today)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("ai_review_queue")
          .select(
            "id, source_job, item_type, candidate_key, candidate_name, confidence, reason, model, trigger, payload, created_at"
          )
          .eq("status", "pending")
          .eq("ai_verdict", "review")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

    const aliasData =
      aliasesResult.status === "fulfilled" && aliasesResult.value.data
        ? (aliasesResult.value.data as KeywordAliasRow[])
        : [];
    setAliases(aliasData);

    if (usageResult.status === "fulfilled" && usageResult.value.data) {
      setUsageRows(usageResult.value.data as AIAutomationUsageRow[]);
    }

    if (pendingResult.status === "fulfilled" && pendingResult.value.data) {
      const existingDecisionPairKeys = new Set(
        aliasData
          .filter((row) => row.decision_type)
          .map((row) => buildAliasPairKey(row.alias, row.canonical_keyword))
          .filter((key): key is string => key !== null)
      );
      const rows = (pendingResult.value.data as QueueRow[]).filter((row) => {
        const canonicalKeyword = getString(row.payload?.canonical_keyword);
        const pairKey = canonicalKeyword
          ? buildAliasPairKey(row.candidate_name, canonicalKeyword)
          : null;
        return (
          canonicalKeyword !== null &&
          cleanDisplayKeyword(canonicalKeyword) !==
            cleanDisplayKeyword(row.candidate_name) &&
          (!pairKey || !existingDecisionPairKeys.has(pairKey))
        );
      });
      setPendingCanonicalRows(rows);
    } else {
      setPendingCanonicalRows([]);
    }

    setLoading(false);
    setRefreshing(false);

    void fetchCrawlerHealth()
      .then((result) => setHealth(result))
      .catch(() => setHealth(null));
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const trimmedQuery = query.trim().toLowerCase();

  const cachedAliases = useMemo(() => {
    return aliases.filter(
      (row) => !row.decision_type && matchesAliasQuery(row, trimmedQuery)
    );
  }, [aliases, trimmedQuery]);

  const savedAliases = useMemo(() => {
    return aliases.filter(
      (row) => Boolean(row.decision_type) && matchesAliasQuery(row, trimmedQuery)
    );
  }, [aliases, trimmedQuery]);

  const cachedAliasCount = useMemo(() => {
    return aliases.filter((row) => !row.decision_type).length;
  }, [aliases]);

  const savedAliasCount = aliases.length - cachedAliasCount;

  const usageByJob = useMemo(() => {
    return usageRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.job_name] = (acc[row.job_name] ?? 0) + 1;
      return acc;
    }, {});
  }, [usageRows]);

  const dailyLimit = health?.daily_ai_limit ?? null;
  const usedToday = usageRows.length;
  const remainingToday =
    dailyLimit === null ? null : Math.max(dailyLimit - usedToday, 0);

  const renderAliasCard = (row: KeywordAliasRow) => {
    const isBusy = decisionBusyId === `alias:${row.id}`;
    const decisionBadge = getDecisionBadge(row.decision_type);

    return (
      <div
        key={row.id}
        className="flex flex-col gap-3 rounded-xl border border-gray-100 p-3"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{row.alias}</span>
              <span className="text-xs text-gray-300">→</span>
              <span className="text-sm font-semibold text-primary">
                {row.canonical_keyword}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                {row.source_job}
              </span>
              {decisionBadge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${decisionBadge.className}`}
                >
                  {decisionBadge.label}
                </span>
              )}
              {row.confidence !== null && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                  {row.confidence.toFixed(2)}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              마지막 반영 {new Date(row.last_seen_at).toLocaleString("ko-KR")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadAlias(row)}
              className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100"
            >
              불러오기
            </button>
            <button
              onClick={() => void deleteAlias(row)}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
            >
              삭제
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <button
            onClick={() => void resolveCachedAlias(row, "merge")}
            disabled={isBusy}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-600 disabled:opacity-50"
          >
            {isBusy ? "처리 중..." : `${row.alias} -> ${row.canonical_keyword} 묶기`}
          </button>
          <button
            onClick={() => void resolveCachedAlias(row, "separate")}
            disabled={isBusy}
            className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            {isBusy ? "처리 중..." : "다른 상품으로 유지"}
          </button>
          <button
            onClick={() => void resolveCachedAlias(row, "reverse")}
            disabled={isBusy}
            className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
          >
            {isBusy ? "처리 중..." : `${row.canonical_keyword} -> ${row.alias} 뒤집기`}
          </button>
        </div>
      </div>
    );
  };

  const resetForm = () => {
    setAliasInput("");
    setCanonicalInput("");
    setConfidenceInput("");
  };

  const saveAlias = async () => {
    const alias = cleanDisplayKeyword(aliasInput);
    const canonicalKeyword = cleanDisplayKeyword(canonicalInput);

    if (!alias || !canonicalKeyword) {
      setSaveStatus("error");
      setSaveMessage("별칭과 대표 키워드를 모두 입력해 주세요.");
      return;
    }

    const aliasNormalized = normalizeKeyword(alias);
    const canonicalNormalized = normalizeKeyword(canonicalKeyword);
    if (!aliasNormalized || !canonicalNormalized) {
      setSaveStatus("error");
      setSaveMessage("정규화 가능한 키워드를 입력해 주세요.");
      return;
    }
    if (aliasNormalized === canonicalNormalized) {
      setSaveStatus("error");
      setSaveMessage("동일한 이름끼리는 동의어로 저장할 수 없습니다.");
      return;
    }

    const parsedConfidence =
      confidenceInput.trim() === "" ? null : Number(confidenceInput);
    if (
      parsedConfidence !== null &&
      (Number.isNaN(parsedConfidence) ||
        parsedConfidence < 0 ||
        parsedConfidence > 1)
    ) {
      setSaveStatus("error");
      setSaveMessage("confidence는 0~1 범위여야 합니다.");
      return;
    }

    setSaveStatus("loading");
    setSaveMessage(null);

    try {
      await saveAliasDecision(
        alias,
        canonicalKeyword,
        "merge",
        parsedConfidence,
        "admin"
      );
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error ? error.message : "동의어 저장 중 오류가 발생했습니다."
      );
      return;
    }

    setSaveStatus("success");
    setSaveMessage("동의어 매핑을 저장했습니다.");
    resetForm();
    await fetchData(true);
  };

  const loadAlias = (row: KeywordAliasRow) => {
    setAliasInput(row.alias);
    setCanonicalInput(row.canonical_keyword);
    setConfidenceInput(row.confidence === null ? "" : String(row.confidence));
    setSaveStatus("idle");
    setSaveMessage("수정할 매핑을 불러왔습니다.");
  };

  const resolvePendingCanonical = async (
    row: QueueRow,
    decision: CanonicalDecision
  ) => {
    const candidateName = cleanDisplayKeyword(row.candidate_name);
    const suggestedCanonical = cleanDisplayKeyword(
      getString(row.payload?.canonical_keyword) ?? ""
    );

    if (!candidateName || !suggestedCanonical) {
      setDecisionStatus("error");
      setDecisionMessage("대표명 제안을 읽을 수 없는 항목입니다.");
      return;
    }

    setDecisionBusyId(row.id);
    setDecisionStatus("loading");
    setDecisionMessage(null);

    try {
      await saveAliasDecision(
        candidateName,
        suggestedCanonical,
        decision,
        row.confidence,
        "admin"
      );

      const now = new Date().toISOString();
      await supabase
        .from("ai_review_queue")
        .update({
          status: decision === "separate" ? "rejected" : "approved",
          resolved_at: now,
          updated_at: now,
        })
        .eq("id", row.id);

      setDecisionStatus("success");
      setDecisionMessage("처리가 완료되었습니다.");
      await fetchData(true);
    } catch (error) {
      setDecisionStatus("error");
      setDecisionMessage(
        error instanceof Error ? error.message : "처리 중 오류가 발생했습니다."
      );
    } finally {
      setDecisionBusyId(null);
    }
  };

  const resolveCachedAlias = async (
    row: KeywordAliasRow,
    decision: CanonicalDecision
  ) => {
    const alias = cleanDisplayKeyword(row.alias);
    const canonicalKeyword = cleanDisplayKeyword(row.canonical_keyword);
    const busyKey = `alias:${row.id}`;

    if (!alias || !canonicalKeyword) {
      setDecisionStatus("error");
      setDecisionMessage("동의어 매핑을 읽을 수 없습니다.");
      return;
    }

    setDecisionBusyId(busyKey);
    setDecisionStatus("loading");
    setDecisionMessage(null);

    try {
      if (decision === "merge") {
        await saveAliasDecision(
          alias,
          canonicalKeyword,
          "merge",
          row.confidence,
          "admin"
        );
        setDecisionMessage(
          `${alias}을(를) ${canonicalKeyword} 동의어로 유지했습니다.`
        );
      } else if (decision === "reverse") {
        await saveAliasDecision(
          alias,
          canonicalKeyword,
          "reverse",
          row.confidence,
          "admin"
        );
        setDecisionMessage(
          `${canonicalKeyword} -> ${alias} 방향으로 대표명을 뒤집었습니다.`
        );
      } else {
        await saveAliasDecision(
          alias,
          canonicalKeyword,
          "separate",
          row.confidence,
          "admin"
        );
        setDecisionMessage(
          `${alias}과 ${canonicalKeyword}을(를) 다른 상품으로 유지했습니다.`
        );
      }

      setDecisionStatus("success");
      await fetchData(true);
    } catch (error) {
      setDecisionStatus("error");
      setDecisionMessage(
        error instanceof Error ? error.message : "동의어 처리 중 오류가 발생했습니다."
      );
    } finally {
      setDecisionBusyId(null);
    }
  };

  const deleteAlias = async (row: KeywordAliasRow) => {
    const normA = normalizeKeyword(row.alias);
    const normB = normalizeKeyword(row.canonical_keyword);
    try {
      const [r1, r2] = await Promise.all([
        supabase
          .from("keyword_aliases")
          .delete()
          .eq("alias_normalized", normA)
          .eq("canonical_normalized", normB),
        supabase
          .from("keyword_aliases")
          .delete()
          .eq("alias_normalized", normB)
          .eq("canonical_normalized", normA),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error ? error.message : "동의어 매핑 삭제 중 오류가 발생했습니다."
      );
      return;
    }

    setSaveStatus("success");
    setSaveMessage("동의어 매핑을 삭제했습니다.");
    await fetchData(true);
  };

  if (loading) {
    return <p className="py-12 text-center text-gray-400">로딩 중..</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-1 text-xs text-gray-400">오늘 자동 AI 사용</p>
          <p className="text-2xl font-bold text-gray-900">{usedToday}</p>
          <p className="mt-1 text-xs text-gray-400">스케줄러 자동 실행 기준</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-1 text-xs text-gray-400">일일 한도</p>
          <p className="text-2xl font-bold text-gray-900">
            {dailyLimit === null ? "-" : dailyLimit}
          </p>
          <p className="mt-1 text-xs text-gray-400">crawler /health 기준</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-1 text-xs text-gray-400">남은 호출</p>
          <p className="text-2xl font-bold text-primary">
            {remainingToday === null ? "-" : remainingToday}
          </p>
          <p className="mt-1 text-xs text-gray-400">Asia/Seoul 날짜 기준</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-1 text-xs text-gray-400">동의어 캐시</p>
          <p className="text-2xl font-bold text-gray-900">{cachedAliasCount}</p>
          <p className="mt-1 text-xs text-gray-400">미처리 AI 감지 결과</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-1 text-xs text-gray-400">저장된 결정</p>
          <p className="text-2xl font-bold text-gray-900">{savedAliasCount}</p>
          <p className="mt-1 text-xs text-gray-400">관리자 묶기/분리 확정</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-1 text-xs text-gray-400">보류 대표명 제안</p>
          <p className="text-2xl font-bold text-gray-900">
            {pendingCanonicalRows.length}
          </p>
          <p className="mt-1 text-xs text-gray-400">동의어 판단 대기 항목</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-gray-900">보류 대표명 제안</h3>
          <p className="text-xs text-gray-400">
            대표명 제안이 같이 온 보류 항목을 동의어 탭에서 바로 정리합니다.
          </p>
        </div>

        {decisionMessage && (
          <p
            className={`mt-3 text-xs ${
              decisionStatus === "error" ? "text-red-500" : "text-green-600"
            }`}
          >
            {decisionMessage}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {pendingCanonicalRows.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              처리할 대표명 제안이 없습니다.
            </p>
          ) : (
            pendingCanonicalRows.map((row) => {
              const suggestedCanonical = cleanDisplayKeyword(
                getString(row.payload?.canonical_keyword) ?? ""
              );
              const rawTerms = getStringArray(row.payload?.raw_terms).slice(0, 4);
              const isBusy = decisionBusyId === row.id;

              return (
                <div
                  key={row.id}
                  className="rounded-xl border border-gray-100 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {row.candidate_name}
                        </span>
                        <span className="text-xs text-gray-300">→</span>
                        <span className="text-sm font-semibold text-primary">
                          {suggestedCanonical}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                          {ITEM_TYPE_LABELS[row.item_type]}
                        </span>
                        <span className="rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
                          보류
                        </span>
                        {row.confidence !== null && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                            {row.confidence.toFixed(2)}
                          </span>
                        )}
                      </div>

                      {row.reason && (
                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                          {row.reason}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                        <span>{row.source_job}</span>
                        {row.model && <span>{row.model}</span>}
                        {row.trigger && <span>trigger {row.trigger}</span>}
                        <span>
                          {new Date(row.created_at).toLocaleString("ko-KR", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      {rawTerms.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {rawTerms.map((term) => (
                            <span
                              key={`${row.id}-${term}`}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                            >
                              {term}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 md:min-w-[240px]">
                      <button
                        onClick={() => void resolvePendingCanonical(row, "merge")}
                        disabled={isBusy}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-600 disabled:opacity-50"
                      >
                        {isBusy
                          ? "처리 중..."
                          : `${row.candidate_name} -> ${suggestedCanonical} 묶기`}
                      </button>
                      <button
                        onClick={() => void resolvePendingCanonical(row, "separate")}
                        disabled={isBusy}
                        className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
                      >
                        {isBusy ? "처리 중..." : "다른 상품으로 유지"}
                      </button>
                      <button
                        onClick={() => void resolvePendingCanonical(row, "reverse")}
                        disabled={isBusy}
                        className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                      >
                        {isBusy
                          ? "처리 중..."
                          : `${suggestedCanonical} -> ${row.candidate_name} 뒤집기`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">스케줄/예산 설정</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">시간대</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {health?.scheduler_timezone || "배포 반영 대기"}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">판매처 갱신 주기</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {health?.store_update_interval_minutes
                    ? `${health.store_update_interval_minutes}분`
                    : "배포 반영 대기"}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">트렌드 감지</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {health?.trend_detection_schedule || "배포 반영 대기"}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">키워드 발굴</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {health?.keyword_discovery_schedule || "배포 반영 대기"}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => void fetchData(true)}
            disabled={refreshing}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            {refreshing ? "새로고침 중.." : "새로고침"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">동의어 매핑 추가/수정</h3>
        <p className="mt-1 text-xs text-gray-400">
          같은 alias로 저장하면 기존 매핑을 덮어씁니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            type="text"
            value={aliasInput}
            onChange={(event) => setAliasInput(event.target.value)}
            placeholder="별칭 예: 두바이 쫀득쿠키"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <input
            type="text"
            value={canonicalInput}
            onChange={(event) => setCanonicalInput(event.target.value)}
            placeholder="대표명 예: 두쫀쿠"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={confidenceInput}
            onChange={(event) => setConfidenceInput(event.target.value)}
            placeholder="confidence 0~1"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <button
            onClick={() => void saveAlias()}
            disabled={saveStatus === "loading"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-600 disabled:opacity-50"
          >
            {saveStatus === "loading" ? "저장 중.." : "저장"}
          </button>
        </div>
        {saveMessage && (
          <p
            className={`mt-3 text-xs ${
              saveStatus === "error" ? "text-red-500" : "text-green-600"
            }`}
          >
            {saveMessage}
          </p>
        )}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">동의어 캐시</h3>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                {trimmedQuery ? `${cachedAliases.length}/${cachedAliasCount}` : cachedAliasCount}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              미처리 AI 감지 결과만 보여줍니다. 처리하면 아래 저장된 결정으로 이동합니다.
            </p>
          </div>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="alias 또는 대표명 검색"
            className="w-full max-w-xs rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {cachedAliases.length === 0 ? (
            <p className="py-8 text-center text-gray-400">
              {trimmedQuery
                ? "검색 조건에 맞는 캐시 alias가 없습니다."
                : "표시할 캐시 alias가 없습니다."}
            </p>
          ) : (
            cachedAliases.map((row) => renderAliasCard(row))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">저장된 동의어 결정</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {trimmedQuery ? `${savedAliases.length}/${savedAliasCount}` : savedAliasCount}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            관리자가 확정한 묶기/분리 결정입니다. 필요하면 여기서 다시 뒤집거나 분리할 수 있습니다.
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {savedAliases.length === 0 ? (
            <p className="py-8 text-center text-gray-400">
              {trimmedQuery
                ? "검색 조건에 맞는 저장된 결정이 없습니다."
                : "저장된 동의어 결정이 없습니다."}
            </p>
          ) : (
            savedAliases.map((row) => renderAliasCard(row))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">오늘 자동 AI 사용 로그</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(usageByJob).length === 0 ? (
            <span className="text-xs text-gray-400">오늘 기록이 없습니다.</span>
          ) : (
            Object.entries(usageByJob).map(([jobName, count]) => (
              <span
                key={jobName}
                className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700"
              >
                {jobName} {count}회
              </span>
            ))
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {usageRows.length === 0 ? (
            <p className="py-8 text-center text-gray-400">
              오늘 자동 AI 사용 기록이 없습니다.
            </p>
          ) : (
            usageRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-xl border border-gray-100 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{row.job_name}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    trigger={row.trigger} /{" "}
                    {new Date(row.created_at).toLocaleString("ko-KR")}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {row.usage_date}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
