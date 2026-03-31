"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import ReportForm from "@/components/ReportForm";
import { supabase } from "@/lib/supabase";
import type { Trend } from "@/lib/types";

interface ReportPageClientProps {
  initialTrends: Trend[];
}

interface MyReportEntry {
  id: string;
  store_name: string;
  trend_name: string;
  status: string;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "verified")
    return (
      <span className="text-[11px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
        지도 반영됨
      </span>
    );
  if (status === "rejected")
    return (
      <span className="text-[11px] font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
        반려
      </span>
    );
  return (
    <span className="text-[11px] font-medium bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
      검토중
    </span>
  );
}

function MyReports() {
  const [reports, setReports] = useState<MyReportEntry[]>([]);

  useEffect(() => {
    const stored: MyReportEntry[] = JSON.parse(
      localStorage.getItem("my_reports") ?? "[]"
    );
    if (!stored.length) return;
    setReports(stored);

    supabase
      .from("reports")
      .select("id, status")
      .in("id", stored.map((r) => r.id))
      .then(({ data }) => {
        if (!data) return;
        const statusMap = Object.fromEntries(data.map((r) => [r.id, r.status]));
        setReports((prev) =>
          prev.map((r) => ({ ...r, status: statusMap[r.id] ?? r.status }))
        );
      });
  }, []);

  if (!reports.length) return null;

  return (
    <div className="mt-6">
      <h3 className="font-bold text-gray-800 mb-3 text-sm">내 제보 내역</h3>
      <div className="flex flex-col gap-2">
        {reports.map((r) => (
          <div
            key={r.id}
            className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">{r.store_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {r.trend_name} ·{" "}
                {new Date(r.created_at).toLocaleDateString("ko-KR")}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportPageClient({ initialTrends }: ReportPageClientProps) {
  return (
    <>
      <Header />
      <main className="page-with-bottom-nav max-w-lg mx-auto px-4 py-4">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900">판매처 제보하기</h2>
          <p className="text-sm text-gray-500 mt-1">
            유행 음식을 파는 곳을 알고 계신가요? 알려주세요!
          </p>
        </div>
        <ReportForm initialTrends={initialTrends} />
        <div className="mt-6 bg-purple-50 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-3 text-sm">
            제보 전 참고하세요 💡
          </h3>
          <ul className="space-y-2 text-sm text-gray-500">
            <li>✅ 정확한 매장명과 주소를 입력해주세요</li>
            <li>✅ 관리자 검토 후 지도에 표시됩니다 (보통 24시간 이내)</li>
            <li>✅ 이미 등록된 매장 중복 제보는 불필요해요</li>
            <li>✅ 카카오맵에서 검색되는 매장명으로 입력하면 정확해요</li>
          </ul>
        </div>
        <MyReports />
      </main>
      <BottomNav />
    </>
  );
}
