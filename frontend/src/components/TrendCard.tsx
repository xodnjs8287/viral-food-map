"use client";

import Image from "next/image";
import Link from "next/link";
import type { Trend } from "@/lib/types";
import TrendBadge from "./TrendBadge";

interface TrendCardProps {
  trend: Trend;
}

export default function TrendCard({ trend }: TrendCardProps) {
  return (
    <Link href={`/trend/${trend.id}`}>
      <div className="bg-white rounded-2xl overflow-hidden shadow-md card-hover border border-gray-100">
        {trend.image_url && (
          <div className="relative h-40 w-full">
            <Image
              src={trend.image_url}
              alt={trend.name}
              fill
              sizes="(max-width: 512px) 100vw, 512px"
              className="object-cover"
            />
            <div className="absolute top-2 right-2">
              <TrendBadge status={trend.status} />
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
              <h3 className="font-bold text-white text-lg tracking-[-0.03em]">{trend.name}</h3>
              <p className="text-xs text-white/80">{trend.category}</p>
            </div>
          </div>
        )}
        {!trend.image_url && (
          <div className="flex items-center gap-3 p-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center text-white text-2xl flex-shrink-0">
              {trend.category === "디저트"
                ? "🍪"
                : trend.category === "음료"
                  ? "🥤"
                  : "🍽️"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900 tracking-[-0.03em]">{trend.name}</h3>
                <TrendBadge status={trend.status} />
              </div>
              <p className="text-xs text-gray-400">{trend.category}</p>
            </div>
          </div>
        )}
        <div className="px-4 py-3">
          <p className="text-sm text-gray-400 mb-2 line-clamp-2">
            {trend.description || "곧 설명이 추가됩니다"}
          </p>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              판매처 {trend.store_count || 0}곳
            </span>
            <div className="flex items-center gap-1.5">
              <span title="네이버·SNS 검색량을 기반으로 매주 업데이트됩니다">인기도 ⓘ</span>
              <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(trend.peak_score, 100)}%` }}
                />
              </div>
              <span className="font-medium text-primary">{Math.min(trend.peak_score, 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
