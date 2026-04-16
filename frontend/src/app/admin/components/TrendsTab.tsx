"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import TrendBadge from "@/components/TrendBadge";

interface TrendRow {
  id: string;
  name: string;
  category: string;
  status: string;
  detected_at: string;
  peak_score: number;
  description: string | null;
  image_url: string | null;
  stores: { count: number }[];
  ai_verdict: string | null;
  ai_reason: string | null;
  ai_confidence: number | null;
  ai_model: string | null;
  ai_reviewed_at: string | null;
  ai_consecutive_accepts: number;
  ai_consecutive_rejects: number;
  score_breakdown: Record<string, number> | null;
}

const SCORE_LABELS: Record<string, { label: string; color: string }> = {
  acceleration: { label: "가속도", color: "bg-red-400" },
  novelty_lift: { label: "신규성", color: "bg-orange-400" },
  blog_freshness: { label: "블로그", color: "bg-blue-400" },
  popularity: { label: "인기도", color: "bg-purple-400" },
  rank: { label: "랭크", color: "bg-gray-400" },
  instagram: { label: "IG", color: "bg-pink-400" },
};

function ScoreBreakdown({ breakdown, total }: { breakdown: Record<string, number>; total: number }) {
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 text-xs">
      <div className="flex h-2.5 rounded-full overflow-hidden">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className={`${SCORE_LABELS[key]?.color ?? "bg-gray-300"}`}
            style={{ width: `${(value / 100) * 100}%` }}
            title={`${SCORE_LABELS[key]?.label ?? key}: ${value}`}
          />
        ))}
      </div>
      <div className="flex gap-3 mt-1 flex-wrap text-gray-400">
        {entries.map(([key, value]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${SCORE_LABELS[key]?.color ?? "bg-gray-300"}`} />
            {SCORE_LABELS[key]?.label ?? key} {value}
          </span>
        ))}
        <span className="font-semibold text-gray-600">= {total}</span>
      </div>
    </div>
  );
}

const CATEGORIES = ["디저트", "음료", "식사", "간식"];
const STATUSES = ["rising", "active", "watchlist", "declining", "inactive"];
const STATUS_LABELS: Record<string, string> = {
  rising: "급상승",
  active: "인기",
  watchlist: "관찰중",
  declining: "하락",
  inactive: "종료",
};

export default function TrendsTab() {
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<TrendRow>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // 생성 폼
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [newStatus, setNewStatus] = useState("rising");
  const [newDescription, setNewDescription] = useState("");

  const fetchTrends = async () => {
    const { data } = await supabase
      .from("trends")
      .select("*, stores(count)")
      .order("created_at", { ascending: false });
    if (data) setTrends(data as TrendRow[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchTrends();
  }, []);

  const filteredTrends =
    statusFilter === "all"
      ? trends
      : trends.filter((t) => t.status === statusFilter);

  const statusCounts: Record<string, number> = {};
  for (const t of trends) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  const promoteTrend = async (t: TrendRow) => {
    await supabase
      .from("trends")
      .update({ status: "active", ai_consecutive_accepts: 0, ai_consecutive_rejects: 0 })
      .eq("id", t.id);
    await fetchTrends();
  };

  const createTrend = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    await supabase.from("trends").insert({
      name: trimmed,
      category: newCategory,
      status: newStatus,
      description: newDescription.trim() || null,
      detected_at: new Date().toISOString(),
      peak_score: 0,
    });

    setNewName("");
    setNewDescription("");
    setShowCreateForm(false);
    await fetchTrends();
  };

  const startEdit = (t: TrendRow) => {
    setEditingId(t.id);
    setEditForm({
      name: t.name,
      status: t.status,
      category: t.category,
      description: t.description,
      image_url: t.image_url,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase
      .from("trends")
      .update({
        name: editForm.name,
        status: editForm.status,
        category: editForm.category,
        description: editForm.description || null,
        image_url: editForm.image_url || null,
      })
      .eq("id", editingId);
    setEditingId(null);
    setEditForm({});
    await fetchTrends();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const confirmDelete = async (t: TrendRow) => {
    // stores 먼저 삭제 후 trend 삭제
    await supabase.from("stores").delete().eq("trend_id", t.id);
    await supabase.from("trends").delete().eq("id", t.id);
    setDeletingId(null);
    await fetchTrends();
  };

  if (loading) {
    return <p className="text-center text-gray-400 py-12">로딩 중...</p>;
  }

  return (
    <div>
      {/* 상태별 요약 카운트 */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter("all")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            statusFilter === "all"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          전체 {trends.length}
        </button>
        {STATUSES.map((s) => {
          const count = statusCounts[s] || 0;
          if (count === 0 && s !== statusFilter) return null;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? "all" : s)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === s
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {STATUS_LABELS[s]} {count}
            </button>
          );
        })}
      </div>

      {/* 생성 버튼 / 폼 */}
      <div className="mb-4">
        {showCreateForm ? (
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <h3 className="font-semibold text-sm text-gray-900 mb-3">새 트렌드 추가</h3>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3 sm:col-span-1">
                  <label className="text-xs text-gray-400 mb-1 block">이름 *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    aria-label="새 트렌드 이름"
                    placeholder="트렌드 이름"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">카테고리</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">상태</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">설명 (선택)</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  aria-label="새 트렌드 설명"
                  placeholder="트렌드 설명..."
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={createTrend}
                  disabled={!newName.trim()}
                  className="px-4 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
                >
                  추가
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-primary hover:text-primary transition-colors"
          >
            + 새 트렌드 추가
          </button>
        )}
      </div>

      {/* 트렌드 목록 */}
      <div className="flex flex-col gap-3">
        {filteredTrends.length === 0 ? (
          <p className="text-center text-gray-400 py-12">
            {statusFilter === "all" ? "등록된 트렌드가 없습니다" : `${STATUS_LABELS[statusFilter]} 트렌드가 없습니다`}
          </p>
        ) : (
          filteredTrends.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-xl p-4 border border-gray-100"
            >
              {editingId === t.id ? (
                /* 편집 모드 */
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">이름</label>
                      <input
                        type="text"
                        value={editForm.name || ""}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        aria-label="트렌드 이름"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">상태</label>
                      <select
                        value={editForm.status || ""}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">카테고리</label>
                      <select
                        value={editForm.category || ""}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">이미지 URL</label>
                      <input
                        type="text"
                        value={editForm.image_url || ""}
                        onChange={(e) => setEditForm({ ...editForm, image_url: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">설명</label>
                    <textarea
                      value={editForm.description || ""}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      취소
                    </button>
                    <button
                      onClick={saveEdit}
                      className="px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-purple-600 transition-colors"
                    >
                      저장
                    </button>
                  </div>
                </div>
              ) : deletingId === t.id ? (
                /* 삭제 확인 */
                <div className="flex items-center justify-between">
                  <p className="text-sm text-red-600 font-medium">
                    &quot;{t.name}&quot; 트렌드와 연결된 판매처 {t.stores?.[0]?.count ?? 0}곳을 삭제하시겠습니까?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => confirmDelete(t)}
                      className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors"
                    >
                      확인
                    </button>
                  </div>
                </div>
              ) : (
                /* 표시 모드 */
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendBadge status={t.status} />
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500"
                      >
                        {t.category}
                      </span>
                      <span className="text-xs text-gray-300">
                        점수 {t.peak_score}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    {t.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{t.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>판매처 {t.stores?.[0]?.count ?? 0}곳</span>
                      <span>{new Date(t.detected_at).toLocaleDateString("ko-KR")}</span>
                    </div>
                    {t.ai_verdict && (
                      <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-block rounded-full px-2 py-0.5 font-semibold ${
                            t.ai_verdict === "accept"
                              ? "bg-green-100 text-green-700"
                              : t.ai_verdict === "reject"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}>
                            AI: {t.ai_verdict}
                          </span>
                          {t.ai_confidence != null && (
                            <span className="text-gray-500">
                              신뢰도 {(t.ai_confidence * 100).toFixed(0)}%
                            </span>
                          )}
                          <span className="text-gray-400">
                            연속 accept {t.ai_consecutive_accepts ?? 0} / reject {t.ai_consecutive_rejects ?? 0}
                          </span>
                        </div>
                        {t.ai_reason && (
                          <p className="mt-1 text-gray-500 leading-relaxed">{t.ai_reason}</p>
                        )}
                      </div>
                    )}
                    {t.score_breakdown && Object.keys(t.score_breakdown).length > 0 && (
                      <ScoreBreakdown breakdown={t.score_breakdown} total={t.peak_score} />
                    )}
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    {t.status === "watchlist" && (
                      <button
                        onClick={() => promoteTrend(t)}
                        className="px-3 py-1.5 bg-green-50 text-green-600 text-xs font-medium rounded-lg hover:bg-green-100 transition-colors"
                      >
                        승격
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(t)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => setDeletingId(t.id)}
                      className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
