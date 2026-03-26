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
  onRetryLocation: () => void;
  onUsePresetLocation: (preset: YomechuLocationPreset) => void;
}

function getLocationCopy(
  status: LocationStatus,
  locationLabel: string | null,
  hasBaseLocation: boolean
) {
  if (hasBaseLocation && locationLabel) {
    if (status === "granted") {
      return `${locationLabel} 기준으로 근처 맛집을 추천합니다.`;
    }

    return `현재 위치 권한 없이 ${locationLabel} 기준으로 추천합니다.`;
  }

  switch (status) {
    case "loading":
      return "현재 위치를 확인하는 중입니다.";
    case "denied":
      return "위치 권한이 없어서 바로 추천할 수 없습니다. 기준 지역을 선택해 계속 진행할 수 있습니다.";
    case "unsupported":
      return "이 브라우저에서는 위치 정보를 사용할 수 없습니다. 아래 기준 지역으로 대신 추천할 수 있습니다.";
    default:
      return "현재 위치 또는 선택한 기준 지역을 바탕으로 근처 맛집을 추천합니다.";
  }
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
          className="border-t border-gray-100 bg-[radial-gradient(circle_at_top,_rgba(155,125,212,0.14),_transparent_55%),linear-gradient(180deg,_#fff_0%,_#faf7ff_100%)]"
        >
          <div className="mx-auto max-w-lg px-4 pb-4">
            <div className="rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_40px_rgba(155,125,212,0.18)]">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-primary/70">
                    Random Nearby Pick
                  </p>
                  <h2 className="mt-1 break-keep text-xl font-black tracking-[-0.04em] text-gray-900">
                    요메추
                  </h2>
                  <p className="mt-1 break-keep text-sm leading-6 text-gray-500">
                    {getLocationCopy(locationStatus, locationLabel, hasBaseLocation)}
                  </p>
                  {locationLabel ? (
                    <p className="mt-2 inline-flex max-w-full items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      현재 기준: {locationLabel}
                    </p>
                  ) : null}
                </div>

                <div className="self-start rounded-2xl bg-primary px-3 py-2 text-white shadow-lg shadow-primary/20">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">
                    Pick
                  </p>
                  <p className="mt-1 break-keep text-sm font-bold">
                    {selectedCount}곳 추천
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {YOMECHU_COUNT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onCountChange(option.value)}
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                          selectedCount === option.value
                            ? "bg-white text-primary"
                            : "bg-white/12 text-white hover:bg-white/20"
                        }`}
                        aria-pressed={selectedCount === option.value}
                      >
                        {option.value}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-2xl bg-gray-950 px-4 py-3 text-white">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/50">
                  Filter
                </p>
                <p className="mt-1 break-keep text-sm font-medium leading-6 text-white/90">
                  거리, 업종, 추천 수를 고르면 근처 후보를 섞어서 바로 추천해 드립니다.
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

              {showPresetSection ? (
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="break-keep text-sm font-semibold text-gray-900">
                        위치 권한이 없어도 사용할 수 있습니다
                      </p>
                      <p className="mt-1 break-keep text-sm leading-6 text-gray-500">
                        기준 지역을 하나 고르면 그 주변으로 요메추를 계속 사용할 수 있습니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onRetryLocation}
                      className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:border-primary hover:text-primary"
                    >
                      내 위치 다시 확인
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
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

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={onSpin}
                  disabled={!canSpin}
                  className="w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 sm:flex-1"
                >
                  {getSpinButtonLabel(selectedCount, isSubmitting)}
                </button>
                {!showPresetSection ? (
                  <button
                    type="button"
                    onClick={onRetryLocation}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:border-primary hover:text-primary sm:w-auto"
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
