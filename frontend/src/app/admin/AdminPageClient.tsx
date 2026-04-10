"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import LoginForm from "./components/LoginForm";
import DashboardTab from "./components/DashboardTab";
import TrendsTab from "./components/TrendsTab";
import KeywordsTab from "./components/KeywordsTab";
import ReportsTab from "./components/ReportsTab";
import StoresTab from "./components/StoresTab";
import YomechuTab from "./components/YomechuTab";
import AiAliasesTab from "./components/AiAliasesTab";
import AiReviewQueueTab from "./components/AiReviewQueueTab";
import TrendReviewsTab from "./components/TrendReviewsTab";
import { supabase } from "@/lib/supabase";

type AdminTab =
  | "dashboard"
  | "trends"
  | "ai-review-queue"
  | "trend-reviews"
  | "keywords"
  | "ai-aliases"
  | "reports"
  | "stores"
  | "yomechu";

const TABS: { key: AdminTab; label: string }[] = [
  { key: "dashboard", label: "대시보드" },
  { key: "trends", label: "트렌드" },
  { key: "ai-review-queue", label: "AI 보류" },
  { key: "trend-reviews", label: "AI 리뷰 로그" },
  { key: "keywords", label: "키워드" },
  { key: "ai-aliases", label: "AI/동의어" },
  { key: "reports", label: "제보 관리" },
  { key: "stores", label: "판매처 관리" },
  { key: "yomechu", label: "요메추" },
];

export default function AdminPageClient() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<AdminTab>("dashboard");
  const [pendingCount, setPendingCount] = useState(0);
  const isAdmin = user?.app_metadata?.role === "admin";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    supabase
      .from("reports")
      .select("id")
      .eq("status", "pending")
      .then(({ data }) => setPendingCount(data?.length ?? 0));
  }, [user, tab]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">로딩 중...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onLogin={setUser} />;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-bold text-gray-900">관리자 권한이 필요합니다.</h1>
          <p className="mt-2 text-sm text-gray-400">
            현재 계정으로는 관리자 페이지에 접근할 수 없습니다.
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setUser(null);
            }}
            className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-600"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-bold text-gray-900">요즘뭐먹 Admin</h1>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setUser(null);
            }}
            className="text-xs text-gray-400 transition-colors hover:text-red-500"
          >
            로그아웃
          </button>
        </div>
        <div className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4">
          {TABS.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === tabItem.key
                  ? "border-primary text-primary"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {tabItem.label}
              {tabItem.key === "reports" && pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {tab === "dashboard" && <DashboardTab />}
        {tab === "trends" && <TrendsTab />}
        {tab === "ai-review-queue" && <AiReviewQueueTab />}
        {tab === "trend-reviews" && <TrendReviewsTab />}
        {tab === "keywords" && <KeywordsTab />}
        {tab === "ai-aliases" && <AiAliasesTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "stores" && <StoresTab />}
        {tab === "yomechu" && <YomechuTab />}
      </main>
    </div>
  );
}
