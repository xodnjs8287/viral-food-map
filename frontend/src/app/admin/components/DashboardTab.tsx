"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import TrendBadge from "@/components/TrendBadge";

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

export default function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTrends, setRecentTrends] = useState<TrendSummary[]>([]);
  const [recentStores, setRecentStores] = useState<RecentStore[]>([]);
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [crawlStatus, setCrawlStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [trendsRes, storesRes, reportsRes, keywordsRes, recentRes, recentStoresRes] =
        await Promise.all([
          supabase.from("trends").select("id, status"),
          supabase.from("stores").select("id, verified"),
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
        ]);

      const trends = trendsRes.data || [];
      const stores = storesRes.data || [];
      const keywords = keywordsRes.data || [];

      setStats({
        trends: {
          total: trends.length,
          rising: trends.filter((t) => t.status === "rising").length,
          active: trends.filter((t) => t.status === "active").length,
        },
        stores: {
          total: stores.length,
          verified: stores.filter((s) => s.verified).length,
          unverified: stores.filter((s) => !s.verified).length,
        },
        pendingReports: reportsRes.data?.length || 0,
        keywords: {
          total: keywords.length,
          active: keywords.filter((k) => k.is_active).length,
        },
      });

      const recentData = (recentRes.data as TrendSummary[]) || [];
      setRecentTrends(recentData);
      setRecentStores((recentStoresRes.data as unknown as RecentStore[]) || []);
      if (recentData.length > 0) {
        setLastDetected(recentData[0].detected_at);
      }
      setLoading(false);
    };

    fetchData();
  }, []);

  const triggerCrawl = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) return;

    setCrawlStatus("loading");
    try {
      const res = await fetch(`${apiUrl}/api/trends/detect`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
      setCrawlStatus("success");
      setTimeout(() => setCrawlStatus("idle"), 3000);
    } catch {
      setCrawlStatus("error");
      setTimeout(() => setCrawlStatus("idle"), 5000);
    }
  };

  if (loading || !stats) {
    return <p className="text-center text-gray-400 py-12">로딩 중...</p>;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

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

      {/* 크롤링 트리거 */}
      <div className="bg-white rounded-xl p-4 border border-gray-100">
        <div className="flex items-center justify-between">
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
          </div>
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
