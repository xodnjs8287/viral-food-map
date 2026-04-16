"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface StoreRow {
  id: string;
  trend_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  place_url: string | null;
  rating: number | null;
  source: string;
  verified: boolean;
  created_at: string;
  last_updated: string | null;
  trends?: { name: string };
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`text-xs ${
            i < full
              ? "text-yellow-400"
              : i === full && half
                ? "text-yellow-300"
                : "text-gray-200"
          }`}
        >
          ★
        </span>
      ))}
      <span className="text-xs text-gray-500 ml-0.5">{rating.toFixed(1)}</span>
    </div>
  );
}

interface TrendOption {
  id: string;
  name: string;
}

export default function StoresTab() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [trends, setTrends] = useState<TrendOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<StoreRow>>({});

  const fetchStores = async () => {
    const { data } = await supabase
      .from("stores")
      .select("*, trends(name)")
      .order("created_at", { ascending: false })
      .range(0, 9999);
    if (data) setStores(data as StoreRow[]);
    setLoading(false);
  };

  const fetchTrends = async () => {
    const { data } = await supabase
      .from("trends")
      .select("id, name")
      .order("name");
    if (data) setTrends(data);
  };

  useEffect(() => {
    Promise.all([fetchStores(), fetchTrends()]);
  }, []);

  const toggleVerified = async (store: StoreRow) => {
    await supabase
      .from("stores")
      .update({ verified: !store.verified })
      .eq("id", store.id);
    await fetchStores();
  };

  const deleteStore = async (id: string) => {
    await supabase.from("stores").delete().eq("id", id);
    await fetchStores();
  };

  const startEdit = (store: StoreRow) => {
    setEditingId(store.id);
    setEditForm({
      name: store.name,
      address: store.address,
      phone: store.phone,
      place_url: store.place_url,
      rating: store.rating,
      verified: store.verified,
      trend_id: store.trend_id,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase
      .from("stores")
      .update({
        name: editForm.name,
        address: editForm.address,
        phone: editForm.phone || null,
        place_url: editForm.place_url || null,
        rating: editForm.rating ?? null,
        verified: editForm.verified,
        trend_id: editForm.trend_id,
      })
      .eq("id", editingId);
    setEditingId(null);
    setEditForm({});
    await fetchStores();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  if (loading) {
    return <p className="text-center text-gray-400 py-12">로딩 중...</p>;
  }

  const filtered = searchQuery
    ? stores.filter(
        (s) =>
          s.name.includes(searchQuery) ||
          s.trends?.name?.includes(searchQuery) ||
          s.address.includes(searchQuery)
      )
    : stores;

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="판매처 검색"
          placeholder="판매처명, 트렌드명, 주소로 검색..."
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
        />
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12">판매처가 없습니다</p>
        ) : (
          filtered.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-xl p-4 border border-gray-100"
            >
              {editingId === s.id ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-xs text-gray-400 mb-1 block">트렌드</label>
                      <select
                        value={editForm.trend_id || ""}
                        onChange={(e) => setEditForm({ ...editForm, trend_id: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      >
                        {trends.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">이름</label>
                      <input
                        type="text"
                        value={editForm.name || ""}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        aria-label="판매처 이름"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">주소</label>
                      <input
                        type="text"
                        value={editForm.address || ""}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                        aria-label="판매처 주소"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">전화번호</label>
                      <input
                        type="text"
                        value={editForm.phone || ""}
                        onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        aria-label="판매처 전화번호"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Place URL</label>
                      <input
                        type="text"
                        value={editForm.place_url || ""}
                        onChange={(e) => setEditForm({ ...editForm, place_url: e.target.value })}
                        aria-label="판매처 Place URL"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">평점 (0~5)</label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={editForm.rating ?? ""}
                        aria-label="판매처 평점"
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            rating: e.target.value ? parseFloat(e.target.value) : null,
                          })
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.verified ?? false}
                          aria-label="판매처 인증 여부"
                          onChange={(e) =>
                            setEditForm({ ...editForm, verified: e.target.checked })
                          }
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-purple-300"
                        />
                        인증됨
                      </label>
                    </div>
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
              ) : (
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
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{s.name}</h3>
                      <StarRating rating={s.rating} />
                    </div>
                    <p className="text-sm text-gray-500">{s.address}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>
                      {s.phone && <span>tel: {s.phone}</span>}
                      {s.place_url && (
                        <a
                          href={s.place_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          장소 링크
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(s)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      수정
                    </button>
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
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
