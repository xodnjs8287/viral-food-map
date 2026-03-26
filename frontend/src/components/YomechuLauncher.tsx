"use client";

import { AnimatePresence, motion } from "framer-motion";

import {
  YOMECHU_CATEGORY_OPTIONS,
  YOMECHU_RADIUS_OPTIONS,
} from "@/lib/crawler";
import type { LocationStatus, YomechuCategorySlug } from "@/lib/types";

interface YomechuLauncherProps {
  open: boolean;
  locationStatus: LocationStatus;
  selectedRadius: number;
  selectedCategory: YomechuCategorySlug;
  isSubmitting: boolean;
  error: string | null;
  onRadiusChange: (radius: number) => void;
  onCategoryChange: (category: YomechuCategorySlug) => void;
  onSpin: () => void;
  onRetryLocation: () => void;
}

function getLocationCopy(status: LocationStatus) {
  switch (status) {
    case "loading":
      return "현재 위치를 확인하는 중입니다.";
    case "granted":
      return "현재 위치가 확인되었습니다. 지금 근처에서 한 곳만 뽑아드립니다.";
    case "denied":
      return "위치 권한이 필요합니다. 브라우저에서 위치 접근을 허용해 주세요.";
    case "unsupported":
      return "이 브라우저에서는 위치 정보를 사용할 수 없습니다.";
    default:
      return "요메추는 현재 위치를 기준으로 추천합니다.";
  }
}

export default function YomechuLauncher({
  open,
  locationStatus,
  selectedRadius,
  selectedCategory,
  isSubmitting,
  error,
  onRadiusChange,
  onCategoryChange,
  onSpin,
  onRetryLocation,
}: YomechuLauncherProps) {
  const canSpin = locationStatus === "granted" && !isSubmitting;

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="border-t border-gray-100 bg-[radial-gradient(circle_at_top,_rgba(155,125,212,0.14),_transparent_55%),linear-gradient(180deg,_#fff_0%,_#faf7ff_100%)]"
        >
          <div className="max-w-lg mx-auto px-4 pb-4">
            <div className="rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_40px_rgba(155,125,212,0.18)]">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-primary/70">
                    Random Nearby Pick
                  </p>
                  <h2 className="mt-1 text-xl font-black tracking-[-0.04em] text-gray-900">
                    요메추
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {getLocationCopy(locationStatus)}
                  </p>
                </div>
                <div className="rounded-2xl bg-primary px-3 py-2 text-right text-white shadow-lg shadow-primary/20">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">
                    Mode
                  </p>
                  <p className="text-sm font-bold">한 곳만</p>
                </div>
              </div>

              <div className="mb-4 rounded-2xl bg-gray-950 px-4 py-3 text-white">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/50">
                  Filter
                </p>
                <p className="mt-1 text-sm font-medium text-white/90">
                  거리와 업종을 고르면 후보를 섞어서 한 곳만 뽑습니다.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500">거리</p>
                  <div className="flex flex-wrap gap-2">
                    {YOMECHU_RADIUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onRadiusChange(option.value)}
                        className={`rounded-full px-3 py-2 text-sm font-semibold transition-all ${
                          selectedRadius === option.value
                            ? "bg-gray-950 text-white shadow-lg shadow-gray-950/15"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500">업종</p>
                  <div className="flex flex-wrap gap-2">
                    {YOMECHU_CATEGORY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onCategoryChange(option.value)}
                        className={`rounded-full px-3 py-2 text-sm font-semibold transition-all ${
                          selectedCategory === option.value
                            ? "bg-primary text-white shadow-lg shadow-primary/20"
                            : "bg-primary/8 text-primary hover:bg-primary/12"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              ) : null}

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSpin}
                  disabled={!canSpin}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {isSubmitting ? "맛집 셔플 중..." : "한 곳만 골라줘"}
                </button>
                {locationStatus !== "granted" ? (
                  <button
                    type="button"
                    onClick={onRetryLocation}
                    className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:border-primary hover:text-primary"
                  >
                    위치 다시 확인
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
