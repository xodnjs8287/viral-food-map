"use client";

import { AnimatePresence, motion } from "framer-motion";

import {
  YOMECHU_CATEGORY_OPTIONS,
  YOMECHU_COUNT_OPTIONS,
  YOMECHU_LOCATION_PRESETS,
  YOMECHU_RADIUS_OPTIONS,
} from "@/lib/crawler";
import type {
  LocationStatus,
  YomechuCategorySlug,
  YomechuLocationPreset,
  YomechuResultCount,
} from "@/lib/types";

interface YomechuLauncherProps {
  open: boolean;
  locationStatus: LocationStatus;
  locationLabel: string | null;
  hasBaseLocation: boolean;
  selectedRadius: number;
  selectedCategory: YomechuCategorySlug;
  selectedCount: YomechuResultCount;
  isSubmitting: boolean;
  error: string | null;
  onRadiusChange: (radius: number) => void;
  onCategoryChange: (category: YomechuCategorySlug) => void;
  onCountChange: (count: YomechuResultCount) => void;
  onSpin: () => void;
  onOpenLocationPicker: () => void;
  onRetryLocation: () => void;
  onUsePresetLocation: (preset: YomechuLocationPreset) => void;
}

function getSpinButtonLabel(count: YomechuResultCount, isSubmitting: boolean) {
  if (isSubmitting) {
    return "추천 후보를 고르는 중...";
  }

  return count === 1 ? "한 곳만 골라줘" : `${count}곳 추천해줘`;
}

export default function YomechuLauncher({
  open,
  locationStatus,
  locationLabel,
  hasBaseLocation,
  selectedRadius,
  selectedCategory,
  selectedCount,
  isSubmitting,
  error,
  onRadiusChange,
  onCategoryChange,
  onCountChange,
  onSpin,
  onOpenLocationPicker,
  onRetryLocation,
  onUsePresetLocation,
}: YomechuLauncherProps) {
  const canSpin = hasBaseLocation && !isSubmitting;
  const showPresetSection = locationStatus !== "granted" || !hasBaseLocation;

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="max-h-[calc(100vh-120px)] overflow-y-auto border-t border-gray-100 bg-[radial-gradient(circle_at_top,_rgba(155,125,212,0.14),_transparent_55%),linear-gradient(180deg,_#fff_0%,_#faf7ff_100%)]"
        >
          <div className="mx-auto max-w-lg px-4 pb-4">
            <div className="rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_40px_rgba(155,125,212,0.18)]">
              <div className="mb-4">
                <h2 className="break-keep text-lg font-black tracking-[-0.04em] text-gray-900">
                  요메추
                </h2>
                <div className="mt-2 flex items-center gap-2">
                  {locationLabel ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                      📍 {locationLabel}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-400">
                      📍 위치 미설정
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={onOpenLocationPicker}
                    className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-primary hover:text-primary"
                  >
                    위치 지정하기
                  </button>
                </div>
              </div>

              <div className="mb-4 rounded-2xl bg-gray-950 px-4 py-3 text-white">
                <p className="break-keep text-sm font-medium leading-6 text-white/90">
                  거리, 업종, 추천 수를 고르면 근처 후보를 섞어서 바로 추천해 드립니다.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500">추천 수</p>
                  <div className="flex flex-wrap gap-2">
                    {YOMECHU_COUNT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onCountChange(option.value)}
                        className={`rounded-full px-3 py-2 text-sm font-semibold transition-all ${
                          selectedCount === option.value
                            ? "bg-primary text-white shadow-lg shadow-primary/20"
                            : "bg-primary/8 text-primary hover:bg-primary/12"
                        }`}
                        aria-pressed={selectedCount === option.value}
                      >
                        {option.value}곳
                      </button>
                    ))}
                  </div>
                </div>

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

              {showPresetSection ? (
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-500">빠른 지역 선택</p>
                  <div className="flex flex-wrap gap-2">
                    {YOMECHU_LOCATION_PRESETS.map((preset) => {
                      const isActive = locationLabel === preset.label;

                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => onUsePresetLocation(preset)}
                          className={`rounded-full px-3 py-2 text-sm font-semibold transition-all ${
                            isActive
                              ? "bg-gray-950 text-white shadow-lg shadow-gray-950/15"
                              : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600">
                  {error}
                </div>
              ) : null}

              <div className="mt-4">
                <button
                  type="button"
                  onClick={onSpin}
                  disabled={!canSpin}
                  className="w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {getSpinButtonLabel(selectedCount, isSubmitting)}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
