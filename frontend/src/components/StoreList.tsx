"use client";

import { useEffect } from "react";
import type { Store } from "@/lib/types";

interface StoreListProps {
  stores: Store[];
  selectedStoreId?: string | null;
  onStoreClick?: (storeId: string) => void;
}

export default function StoreList({
  stores,
  selectedStoreId,
  onStoreClick,
}: StoreListProps) {
  useEffect(() => {
    if (!selectedStoreId) return;
    document
      .getElementById(`store-${selectedStoreId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedStoreId]);

  if (stores.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p className="text-3xl mb-2">📍</p>
        <p className="text-sm">아직 등록된 판매처가 없어요</p>
        <p className="text-xs mt-1">제보 탭에서 알려주세요!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stores.map((store) => (
        <div
          key={store.id}
          id={`store-${store.id}`}
          onClick={() => onStoreClick?.(store.id)}
          className={`bg-white rounded-xl p-3 border flex items-center gap-3 transition-all ${
            onStoreClick ? "cursor-pointer" : ""
          } ${
            store.id === selectedStoreId
              ? "ring-2 ring-purple-400 border-purple-300"
              : "border-gray-100"
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-lg flex-shrink-0">
            {store.verified ? "✅" : "📍"}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm text-gray-900 truncate">
              {store.name}
            </h4>
            <p className="text-xs text-gray-400 truncate">{store.address}</p>
          </div>
          <div className="flex-shrink-0 text-xs text-gray-300">
            {store.source === "user_report" ? "제보" : "자동수집"}
          </div>
        </div>
      ))}
    </div>
  );
}
