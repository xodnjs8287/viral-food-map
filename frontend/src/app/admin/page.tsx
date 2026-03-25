"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

function LoginForm({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (authError) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다");
      return;
    }
    if (data.user) onLogin(data.user);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">요즘뭐먹 Admin</h1>
          <p className="text-sm text-gray-400 mt-1">관리자 로그인</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            required
          />
          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-purple-600 transition-colors disabled:opacity-50"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}

interface ReportRow {
  id: string;
  trend_id: string;
  store_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  status: string;
  created_at: string;
  trends?: { name: string };
}

interface StoreRow {
  id: string;
  trend_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
  verified: boolean;
  created_at: string;
  trends?: { name: string };
}

type Tab = "reports" | "stores";

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<Tab>("reports");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthChecked(true);
    });
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">로딩 중...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onLogin={setUser} />;
  }

  const fetchReports = async () => {
    const { data } = await supabase
      .from("reports")
      .select("*, trends(name)")
      .order("created_at", { ascending: false });
    if (data) setReports(data as ReportRow[]);
  };

  const fetchStores = async () => {
    const { data } = await supabase
      .from("stores")
      .select("*, trends(name)")
      .order("created_at", { ascending: false });
    if (data) setStores(data as StoreRow[]);
  };

  useEffect(() => {
    Promise.all([fetchReports(), fetchStores()]).then(() => setLoading(false));
  }, []);

  const approveReport = async (report: ReportRow) => {
    // report 상태를 verified로 변경
    await supabase
      .from("reports")
      .update({ status: "verified" })
      .eq("id", report.id);

    // 좌표가 있으면 stores에 삽입
    if (report.lat && report.lng) {
      await supabase.from("stores").insert({
        trend_id: report.trend_id,
        name: report.store_name,
        address: report.address,
        lat: report.lat,
        lng: report.lng,
        phone: null,
        source: "user_report",
        verified: true,
      });
    }

    await fetchReports();
    await fetchStores();
  };

  const rejectReport = async (report: ReportRow) => {
    await supabase.from("reports").delete().eq("id", report.id);
    await fetchReports();
  };

  const deleteStore = async (id: string) => {
    await supabase.from("stores").delete().eq("id", id);
    await fetchStores();
  };

  const toggleVerified = async (store: StoreRow) => {
    await supabase
      .from("stores")
      .update({ verified: !store.verified })
      .eq("id", store.id);
    await fetchStores();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">로딩 중...</p>
      </div>
    );
  }

  const pendingCount = reports.filter((r) => r.status === "pending").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">요즘뭐먹 Admin</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              제보 {reports.length}건 / 판매처 {stores.length}곳
            </span>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                setUser(null);
              }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 flex gap-1">
          <button
            onClick={() => setTab("reports")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "reports"
                ? "border-primary text-primary"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            제보 관리
            {pendingCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("stores")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "stores"
                ? "border-primary text-primary"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            판매처 관리
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {tab === "reports" && (
          <div className="space-y-3">
            {reports.length === 0 ? (
              <p className="text-center text-gray-400 py-12">제보가 없습니다</p>
            ) : (
              reports.map((r) => (
                <div
                  key={r.id}
                  className={`bg-white rounded-xl p-4 border ${
                    r.status === "pending"
                      ? "border-yellow-200"
                      : "border-gray-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.status === "pending"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {r.status === "pending" ? "대기중" : "승인됨"}
                        </span>
                        <span className="text-xs text-purple-500 font-medium">
                          {r.trends?.name}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900">
                        {r.store_name}
                      </h3>
                      <p className="text-sm text-gray-500">{r.address}</p>
                      {r.note && (
                        <p className="text-xs text-gray-400 mt-1">
                          메모: {r.note}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span>
                          {new Date(r.created_at).toLocaleString("ko-KR")}
                        </span>
                        <span>
                          좌표: {r.lat && r.lng ? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}` : "없음"}
                        </span>
                      </div>
                    </div>

                    {r.status === "pending" && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => approveReport(r)}
                          className="px-3 py-1.5 bg-green-500 text-white text-xs font-medium rounded-lg hover:bg-green-600 transition-colors"
                        >
                          승인
                        </button>
                        <button
                          onClick={() => rejectReport(r)}
                          className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors"
                        >
                          거절
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "stores" && (
          <div className="space-y-3">
            {stores.length === 0 ? (
              <p className="text-center text-gray-400 py-12">
                판매처가 없습니다
              </p>
            ) : (
              stores.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-xl p-4 border border-gray-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            s.verified
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {s.verified ? "인증됨" : "미인증"}
                        </span>
                        <span className="text-xs text-purple-500 font-medium">
                          {s.trends?.name}
                        </span>
                        <span className="text-xs text-gray-300">
                          {s.source === "user_report" ? "제보" : "자동수집"}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900">{s.name}</h3>
                      <p className="text-sm text-gray-500">{s.address}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                      </p>
                    </div>

                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleVerified(s)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          s.verified
                            ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            : "bg-green-500 text-white hover:bg-green-600"
                        }`}
                      >
                        {s.verified ? "인증해제" : "인증"}
                      </button>
                      <button
                        onClick={() => deleteStore(s.id)}
                        className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
