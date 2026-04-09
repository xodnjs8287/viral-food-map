"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import TrendBadge from "@/components/TrendBadge";
import {
  fetchCrawlerHealth,
  fetchTrendDetectionStatus,
  getCrawlerBaseUrl,
  publishInstagramFeed,
  triggerTrendDetection,
  type InstagramPublishSummary,
  type TrendDetectionJobStatus,
  type TrendDetectionSummary,
} from "@/lib/crawler";
import type { AnalyticsSummary } from "@/lib/types";

interface TrendSummary {
  id: string;
  name: string;
  status: string;
  detected_at: string;
  stores: { count: number }[];
}

interface RecentStore {
  id: string;
  name: string;
  created_at: string;
  trends?: { name: string } | null;
}

interface DashboardStats {
  trends: { total: number; rising: number; active: number };
  stores: { total: number; verified: number; unverified: number };
  pendingReports: number;
  keywords: { total: number; active: number };
}

type RequestStatus = "idle" | "loading" | "success" | "error";
const TREND_DETECTION_POLL_INTERVAL_MS = 2000;
const TREND_DETECTION_TIMEOUT_MS = 10 * 60 * 1000;

function getPageDisplayName(path: string): string {
  if (path === "/") return "홈";
  if (path === "/map") return "지도";
  if (path === "/report") return "제보";
  if (path.startsWith("/trend/")) return "트렌드 상세";
  if (path === "/admin") return "어드민";
  return path;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatTrendDetectionSummary(summary: TrendDetectionSummary | null) {
  if (!summary) {
    return "크롤링이 완료되었습니다.";
  }

  return `${summary.confirmed}개 트렌드, ${summary.stored_stores}개 판매처를 반영했습니다.`;
}

function getInstagramTargetName(summary: InstagramPublishSummary) {
  return summary.published_trend?.name || summary.run?.trend_name_snapshot || null;
}

function getInstagramRequestStatus(summary: InstagramPublishSummary): RequestStatus {
  if (summary.status === "published") {
    return "success";
  }

  if (summary.status === "noop" && summary.reason === "failed_requires_force_retry") {
    return "error";
  }

  if (summary.status === "skipped" && summary.skip_reason === "all_candidates_failed") {
    return "error";
  }

  return "success";
}

function formatInstagramPublishMessage(summary: InstagramPublishSummary) {
  const trendName = getInstagramTargetName(summary);

  switch (summary.status) {
    case "published":
      return trendName
        ? `${trendName} 게시를 완료했습니다${summary.used_fallback_image ? " (대체 이미지를 사용했습니다)." : "."}`
        : `인스타그램 게시를 완료했습니다${summary.used_fallback_image ? " (대체 이미지를 사용했습니다)." : "."}`;
    case "noop":
      if (summary.reason === "already_completed") {
        return trendName
          ? `${trendName} 게시가 이미 완료되어 있습니다.`
          : "오늘자 인스타그램 게시가 이미 완료되어 있습니다.";
      }
      if (summary.reason === "already_running") {
        return "인스타그램 게시 작업이 이미 실행 중입니다.";
      }
      if (summary.reason === "failed_requires_force_retry") {
        return "이전 인스타그램 게시가 실패 상태입니다. 강제 재시도가 필요합니다.";
      }
      return "인스타그램 게시 요청이 이미 처리되었습니다.";
    case "skipped":
      if (summary.skip_reason === "no_candidates") {
        return "게시 가능한 트렌드 후보가 없습니다.";
      }
      if (summary.skip_reason === "all_candidates_failed") {
        return summary.errors?.[0]
          ? `게시 후보 처리에 실패했습니다: ${summary.errors[0]}`
          : "게시 후보 처리에 실패했습니다.";
      }
      return "인스타그램 게시가 건너뛰어졌습니다.";
    case "dry_run":
      return `게시 후보 ${summary.candidate_count ?? 0}건을 확인했습니다.`;
    default:
      return "인스타그램 게시 요청을 처리했습니다.";
  }
}

export default function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [recentTrends, setRecentTrends] = useState<TrendSummary[]>([]);
  const [recentStores, setRecentStores] = useState<RecentStore[]>([]);
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [crawlStatus, setCrawlStatus] = useState<RequestStatus>("idle");
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);
  const [instagramStatus, setInstagramStatus] = useState<RequestStatus>("idle");
  const [instagramMessage, setInstagramMessage] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<RequestStatus>("idle");
  const [healthMessage, setHealthMessage] = useState<string | null>(null);
  const [lastHealthCheckedAt, setLastHealthCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const [trendsRes, storesRes, storesVerifiedRes, storesUnverifiedRes, reportsRes, keywordsRes, recentRes, recentStoresRes, analyticsRes] =
      await Promise.all([
        supabase.from("trends").select("id, status"),
        supabase.from("stores").select("*", { count: "exact", head: true }),
        supabase.from("stores").select("*", { count: "exact", head: true }).eq("verified", true),
        supabase.from("stores").select("*", { count: "exact", head: true }).eq("verified", false),
        supabase.from("reports").select("id").eq("status", "pending"),
        supabase.from("keywords").select("id, is_active"),
        supabase
          .from("trends")
          .select("id, name, status, detected_at, stores(count)")
          .order("detected_at", { ascending: false })
          .limit(5),
        supabase
          .from("stores")
          .select("id, name, created_at, trends(name)")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.rpc("get_analytics_summary", { days_back: 14 }),
      ]);

    const trends = trendsRes.data || [];
    const keywords = keywordsRes.data || [];

    setStats({
      trends: {
        total: trends.length,
        rising: trends.filter((t) => t.status === "rising").length,
        active: trends.filter((t) => t.status === "active").length,
      },
      stores: {
        total: storesRes.count || 0,
        verified: storesVerifiedRes.count || 0,
        unverified: storesUnverifiedRes.count || 0,
      },
      pendingReports: reportsRes.data?.length || 0,
      keywords: {
        total: keywords.length,
        active: keywords.filter((k) => k.is_active).length,
      },
    });

    if (analyticsRes.data) {
      setAnalytics(analyticsRes.data as AnalyticsSummary);
    }

    const recentData = (recentRes.data as TrendSummary[]) || [];
    setRecentTrends(recentData);
    setRecentStores((recentStoresRes.data as unknown as RecentStore[]) || []);
    if (recentData.length > 0) {
      setLastDetected(recentData[0].detected_at);
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const getAdminAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    if (!accessToken) {
      throw new Error("관리자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
    }

    return accessToken;
  };

  const waitForTrendDetectionCompletion = async (): Promise<TrendDetectionJobStatus> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < TREND_DETECTION_TIMEOUT_MS) {
      const job = await fetchTrendDetectionStatus();

      if (job.state === "completed") {
        return job;
      }

      if (job.state === "failed") {
        throw new Error(job.last_error || "수동 크롤링 실행에 실패했습니다.");
      }

      await delay(TREND_DETECTION_POLL_INTERVAL_MS);
    }

    throw new Error("크롤링 완료 확인이 지연되고 있습니다.");
  };

  const triggerCrawl = async () => {
    const apiUrl = getCrawlerBaseUrl();
    if (!apiUrl) return;

    setCrawlStatus("loading");
    setCrawlMessage("크롤링 작업을 준비하고 있습니다.");
    try {
      const accessToken = await getAdminAccessToken();
      const result = await triggerTrendDetection(accessToken);
      setCrawlMessage(
        result.accepted
          ? "크롤링을 시작했습니다. 완료 여부를 확인하고 있습니다."
          : "이미 실행 중인 크롤링을 확인하고 있습니다."
      );
      const job = await waitForTrendDetectionCompletion();
      await fetchData();
      setCrawlStatus("success");
      setCrawlMessage(formatTrendDetectionSummary(job.last_summary));
      setTimeout(() => setCrawlStatus("idle"), 3000);
    } catch (error) {
      setCrawlStatus("error");
      setCrawlMessage(
        error instanceof Error ? error.message : "수동 크롤링 실행에 실패했습니다."
      );
      setTimeout(() => setCrawlStatus("idle"), 5000);
    }
  };

  const triggerInstagramPost = async () => {
    const apiUrl = getCrawlerBaseUrl();
    if (!apiUrl) return;

    setInstagramStatus("loading");
    setInstagramMessage("인스타그램 게시를 실행하고 있습니다.");
    try {
      const accessToken = await getAdminAccessToken();
      const result = await publishInstagramFeed(accessToken);
      const nextStatus = getInstagramRequestStatus(result.summary);
      setInstagramStatus(nextStatus);
      setInstagramMessage(formatInstagramPublishMessage(result.summary));
      setTimeout(() => setInstagramStatus("idle"), nextStatus === "error" ? 5000 : 3000);
    } catch (error) {
      setInstagramStatus("error");
      setInstagramMessage(
        error instanceof Error ? error.message : "인스타그램 게시 실행에 실패했습니다."
      );
      setTimeout(() => setInstagramStatus("idle"), 5000);
    }
  };

  const checkCrawlerStatus = async () => {
    const apiUrl = getCrawlerBaseUrl();
    if (!apiUrl) return;

    setHealthStatus("loading");
    setHealthMessage(null);
    try {
      const result = await fetchCrawlerHealth();
      setHealthStatus("success");
      setLastHealthCheckedAt(new Date().toISOString());
      setHealthMessage(`${result.service} ${result.status}`);
      setTimeout(() => setHealthStatus("idle"), 3000);
    } catch (error) {
      setHealthStatus("error");
      setLastHealthCheckedAt(new Date().toISOString());
      setHealthMessage(
        error instanceof Error ? error.message : "크롤러 상태 확인에 실패했습니다."
      );
      setTimeout(() => setHealthStatus("idle"), 5000);
    }
  };

  if (loading || !stats) {
    return <p className="text-center text-gray-400 py-12">로딩 중...</p>;
  }

  const apiUrl = getCrawlerBaseUrl();

  const dailyViews = analytics?.daily_views ?? [];
  const hourlyDistribution = analytics?.hourly_distribution ?? [];
  const dailyMax = dailyViews.length > 0
    ? Math.max(...dailyViews.map((d) => d.view_count), 1)
    : 1;
  const uniqueMax = dailyViews.length > 0
    ? Math.max(...dailyViews.map((d) => d.unique_count), 1)
    : 1;
  const hourlyMax = hourlyDistribution.length > 0
    ? Math.max(...hourlyDistribution.map((h) => h.view_count), 1)
    : 1;
  const hourlyDistributionByHour = new Map(
    hourlyDistribution.map((entry) => [entry.hour, entry.view_count])
  );
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <div className="flex flex-col gap-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 mb-1">트렌드</p>
          <p className="text-2xl font-bold text-gray-900">{stats.trends.total}</p>
          <p className="text-xs text-gray-400 mt-1">
            급상승 {stats.trends.rising} / 인기 {stats.trends.active}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 mb-1">판매처</p>
          <p className="text-2xl font-bold text-gray-900">{stats.stores.total}</p>
          <p className="text-xs text-gray-400 mt-1">
            인증 {stats.stores.verified} / 미인증 {stats.stores.unverified}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 mb-1">대기 제보</p>
          <p className={`text-2xl font-bold ${stats.pendingReports > 0 ? "text-red-500" : "text-gray-900"}`}>
            {stats.pendingReports}
          </p>
          <p className="text-xs text-gray-400 mt-1">승인 대기 중</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 mb-1">키워드</p>
          <p className="text-2xl font-bold text-gray-900">{stats.keywords.active}</p>
          <p className="text-xs text-gray-400 mt-1">
            활성 {stats.keywords.active} / 전체 {stats.keywords.total}
          </p>
        </div>
      </div>

      {/* 방문 통계 카드 */}
      {analytics && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">총 페이지뷰</p>
              <p className="text-2xl font-bold text-purple-600">
                {analytics.total_views.toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">오늘 방문</p>
              <p className="text-2xl font-bold text-purple-600">
                {analytics.today_views.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                순 방문 {analytics.today_unique}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">순 방문자</p>
              <p className="text-2xl font-bold text-blue-500">
                {analytics.unique_visitors.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-1">전체 기간</p>
            </div>
          </div>

          {/* 일별 방문 추이 */}
          {dailyViews.length > 0 && (
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">일별 방문 추이 (14일)</h3>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    {dailyViews.map((day) => (
                      <span key={`${day.date}-views-value`} className="flex-1 text-center text-[10px] text-gray-400">
                        {day.view_count}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-end gap-1 h-24">
                    {dailyViews.map((day) => {
                      const heightPercent = (day.view_count / dailyMax) * 100;
                      return (
                        <div key={`${day.date}-views-bar`} className="flex-1 h-full flex items-end">
                          <div
                            className="w-full rounded-t-sm min-h-[2px]"
                            style={{
                              height: `${heightPercent}%`,
                              backgroundColor: "#9B7DD4",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {dailyViews.map((day) => (
                      <span key={`${day.date}-views-label`} className="flex-1 text-center text-[10px] text-gray-400">
                        {new Date(day.date).getDate()}일
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    {dailyViews.map((day) => (
                      <span key={`${day.date}-unique-value`} className="flex-1 text-center text-[10px] text-gray-400">
                        {day.unique_count}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-end gap-1 h-16">
                    {dailyViews.map((day) => {
                      const heightPercent = (day.unique_count / uniqueMax) * 100;
                      return (
                        <div key={`${day.date}-unique-bar`} className="flex-1 h-full flex items-end">
                          <div
                            className="w-full rounded-t-sm min-h-[2px]"
                            style={{
                              height: `${heightPercent}%`,
                              backgroundColor: "#8BACD8",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#9B7DD4" }} />
                  <span className="text-[10px] text-gray-400">페이지뷰</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#8BACD8" }} />
                  <span className="text-[10px] text-gray-400">순 방문자</span>
                </div>
              </div>
            </div>
          )}

          {/* 시간대별 방문 분포 */}
          {hourlyDistribution.length > 0 && (
            <div className="bg-white rounded-xl p-4 border border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">시간대별 방문 분포 (최근 7일)</h3>
              <div className="flex flex-col gap-1">
                <div className="flex items-end gap-[2px] h-24">
                  {hours.map((hour) => {
                    const count = hourlyDistributionByHour.get(hour) ?? 0;
                    const heightPercent = (count / hourlyMax) * 100;
                    return (
                      <div key={`${hour}-bar`} className="flex-1 h-full flex items-end">
                        <div
                          className="w-full rounded-t-sm min-h-[2px]"
                          style={{
                            height: `${heightPercent}%`,
                            backgroundColor: count > 0 ? "#9B7DD4" : "#E5E7EB",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-[2px]">
                  {hours.map((hour) => (
                    <span key={`${hour}-label`} className="flex-1 text-center text-[9px] text-gray-400">
                      {hour % 3 === 0 ? hour : ""}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1 text-right">시 (0~23)</p>
            </div>
          )}

          {/* 인기 페이지 TOP 5 */}
          {analytics.top_pages && analytics.top_pages.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">인기 페이지 TOP 5</h3>
              <div className="flex flex-col gap-2">
                {analytics.top_pages.map((page, i) => (
                  <div
                    key={page.page_path}
                    className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-purple-500 w-5">{i + 1}</span>
                      <span className="font-medium text-sm text-gray-900">
                        {getPageDisplayName(page.page_path)}
                      </span>
                      <span className="text-xs text-gray-400">{page.page_path}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-700">
                      {page.view_count.toLocaleString()}회
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 트렌드별 조회수 */}
          {analytics.trend_views && analytics.trend_views.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">트렌드별 조회수</h3>
              <div className="flex flex-col gap-2">
                {analytics.trend_views.map((tv, i) => {
                  const maxTrendViews = analytics.trend_views![0].view_count;
                  const barPercent = (tv.view_count / maxTrendViews) * 100;
                  return (
                    <div
                      key={tv.trend_id}
                      className="bg-white rounded-xl p-3 border border-gray-100"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-purple-500 w-5">{i + 1}</span>
                          <span className="font-medium text-sm text-gray-900">{tv.trend_name}</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-700">
                          {tv.view_count.toLocaleString()}회
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${barPercent}%`,
                            backgroundColor: "#9B7DD4",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* 크롤링 트리거 */}
      <div className="bg-white rounded-xl p-4 border border-gray-100">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">수동 크롤링</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              트렌드 감지 + 판매처 수집을 즉시 실행합니다
            </p>
            {lastDetected && (
              <p className="text-xs text-gray-400 mt-1">
                마지막 감지: {new Date(lastDetected).toLocaleString("ko-KR")}
              </p>
            )}
            {crawlMessage && (
              <p
                className={`text-xs mt-2 ${
                  crawlStatus === "error"
                    ? "text-red-500"
                    : crawlStatus === "success"
                      ? "text-green-600"
                      : "text-gray-500"
                }`}
              >
                {crawlMessage}
              </p>
            )}
            {healthMessage && (
              <p
                className={`text-xs mt-2 ${
                  healthStatus === "error"
                    ? "text-red-500"
                    : healthStatus === "success"
                      ? "text-blue-600"
                      : "text-gray-500"
                }`}
              >
                {healthMessage}
              </p>
            )}
            {lastHealthCheckedAt && (
              <p className="text-xs text-gray-400 mt-1">
                상태 확인: {new Date(lastHealthCheckedAt).toLocaleString("ko-KR")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <button
              onClick={checkCrawlerStatus}
              disabled={!apiUrl || healthStatus === "loading"}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${
                healthStatus === "success"
                  ? "bg-blue-500 text-white"
                  : healthStatus === "error"
                    ? "bg-red-500 text-white"
                    : "bg-sky-100 text-sky-700 hover:bg-sky-200"
              }`}
            >
              {healthStatus === "loading"
                ? "확인 중..."
                : healthStatus === "success"
                  ? "상태 정상"
                  : healthStatus === "error"
                    ? "확인 실패"
                    : !apiUrl
                      ? "API URL 미설정"
                      : "상태 체크"}
            </button>
            <button
            onClick={triggerCrawl}
            disabled={!apiUrl || crawlStatus === "loading"}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${
              crawlStatus === "success"
                ? "bg-green-500 text-white"
                : crawlStatus === "error"
                  ? "bg-red-500 text-white"
                  : "bg-primary text-white hover:bg-purple-600"
            }`}
          >
            {crawlStatus === "loading"
              ? "실행 중..."
              : crawlStatus === "success"
                ? "완료!"
                : crawlStatus === "error"
                  ? "실패"
                  : !apiUrl
                    ? "API URL 미설정"
                    : "크롤링 실행"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 border border-gray-100">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">인스타그램 수동 게시</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              오늘 게시 후보 중 1건을 인스타그램 피드에 바로 게시합니다
            </p>
            {instagramMessage && (
              <p
                className={`text-xs mt-2 ${
                  instagramStatus === "error"
                    ? "text-red-500"
                    : instagramStatus === "success"
                      ? "text-green-600"
                      : "text-gray-500"
                }`}
              >
                {instagramMessage}
              </p>
            )}
          </div>
          <button
            onClick={triggerInstagramPost}
            disabled={!apiUrl || instagramStatus === "loading"}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${
              instagramStatus === "success"
                ? "bg-green-500 text-white"
                : instagramStatus === "error"
                  ? "bg-red-500 text-white"
                  : "bg-primary text-white hover:bg-purple-600"
            }`}
          >
            {instagramStatus === "loading"
              ? "게시 중..."
              : instagramStatus === "success"
                ? "완료!"
                : instagramStatus === "error"
                  ? "실패"
                  : !apiUrl
                    ? "API URL 미설정"
                    : "인스타 게시"}
          </button>
        </div>
      </div>

      {/* 최근 트렌드 */}
      <div>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">최근 감지된 트렌드</h3>
        <div className="flex flex-col gap-2">
          {recentTrends.length === 0 ? (
            <p className="text-center text-gray-400 py-8">감지된 트렌드가 없습니다</p>
          ) : (
            recentTrends.map((t) => (
              <div
                key={t.id}
                className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <TrendBadge status={t.status} />
                  <span className="font-medium text-sm text-gray-900">{t.name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>판매처 {t.stores?.[0]?.count ?? 0}곳</span>
                  <span>{new Date(t.detected_at).toLocaleDateString("ko-KR")}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {/* 최근 수집된 판매처 */}
      <div>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">최근 수집된 판매처</h3>
        <div className="flex flex-col gap-2">
          {recentStores.length === 0 ? (
            <p className="text-center text-gray-400 py-8">수집된 판매처가 없습니다</p>
          ) : (
            recentStores.map((s) => (
              <div
                key={s.id}
                className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm text-gray-900">{s.name}</span>
                  <span className="text-xs text-purple-500 font-medium">
                    {s.trends?.name}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(s.created_at).toLocaleString("ko-KR")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
