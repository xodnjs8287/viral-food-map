"use client";

import { useEffect } from "react";
import { openExternalUrl, openInstagramTag } from "@/lib/external-links";
import type { Store } from "@/lib/types";

interface StoreListProps {
  stores: Store[];
  userLoc?: { lat: number; lng: number } | null;
  selectedStoreId?: string | null;
  onStoreClick?: (storeId: string) => void;
}

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
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

function getStoreLinkInfo(store: Store): { url: string; label: string; className: string } {
  const url = store.place_url || `https://map.naver.com/p/search/${encodeURIComponent(store.name)}`;
  if (url.includes("kakao"))
    return { url, label: "카카오", className: "bg-yellow-400 text-black text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-yellow-500 transition-colors" };
  if (url.includes("naver"))
    return { url, label: "네이버", className: "bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-green-600 transition-colors" };
  return { url, label: "지도 보기", className: "bg-gray-400 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-gray-500 transition-colors" };
}

export default function StoreList({
  stores,
  userLoc,
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
          className={`bg-white rounded-xl p-3 border flex items-center gap-3 transition-all cursor-pointer ${
            store.id === selectedStoreId
              ? "ring-2 ring-purple-400 border-purple-300"
              : "border-gray-100"
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-lg flex-shrink-0">
            {store.verified ? "✅" : "📍"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-semibold text-sm text-gray-900 truncate">
                {store.name}
              </h4>
              <StarRating rating={store.rating} />
            </div>
            <p className="text-xs text-gray-400 truncate">{store.address}</p>
          </div>
          {userLoc && (
            <span className="text-xs text-primary font-semibold flex-shrink-0 mr-1">
              {formatDistance(getDistance(userLoc.lat, userLoc.lng, store.lat, store.lng))}
            </span>
          )}
          <div className="flex gap-1.5 flex-shrink-0">
            {(() => {
              const linkInfo = getStoreLinkInfo(store);
              return (
                <a
                  href={linkInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openExternalUrl(linkInfo.url);
                  }}
                  className={linkInfo.className}
                >
                  {linkInfo.label}
                </a>
              );
            })()}
            <button
              onClick={(e) => {
                e.stopPropagation();
                openInstagramTag(store.name);
              }}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:opacity-90 transition-opacity"
            >
              인스타
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
