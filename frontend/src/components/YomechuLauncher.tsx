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
  locationSource: "device" | "preset" | "manual" | null;
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

function getLocationStatusLabel(
  status: LocationStatus,
  source: "device" | "preset" | "manual" | null,
  hasBaseLocation: boolean
) {
  if (source === "device") {
    return "현재 위치 설정됨";
  }

  if (hasBaseLocation) {
    return "위치 지정 완료";
  }

  if (status === "loading") {
    return "현재 위치 확인 중";
  }

  if (status === "invalid") {
    return "위치 확인 필요";
  }

  return "위치 지정 필요";
}

function getLocationDescription(
  status: LocationStatus,
  source: "device" | "preset" | "manual" | null,
  hasBaseLocation: boolean
) {
  if (source === "device") {
    return "현재 위치를 기본 기준으로 사용 중입니다. 필요하면 위치 지정하기로 바꿀 수 있습니다.";
  }

  if (hasBaseLocation) {
    return "지정한 기준 위치를 바탕으로 근처 맛집을 추천합니다.";
  }

  switch (status) {
    case "loading":
      return "현재 위치를 확인하고 있습니다. 잠시만 기다려 주세요.";
    case "denied":
      return "현재 위치를 가져오지 못했습니다. 위치 지정하기로 기준 위치를 정하면 계속 사용할 수 있습니다.";
    case "invalid":
      return "현재 위치 좌표가 정확하지 않아 추천에 사용하지 않았습니다. 현재 위치를 다시 확인하거나 직접 위치를 지정해 주세요.";
    case "unsupported":
      return "이 브라우저에서는 위치 정보를 읽을 수 없습니다. 위치 지정하기로 기준 위치를 정해 주세요.";
    default:
      return "현재 위치를 기본으로 사용합니다. 필요하면 위치 지정하기로 바꿀 수 있습니다.";
  }
}

function getLocationLine(
  source: "device" | "preset" | "manual" | null,
  locationLabel: string | null
) {
  if (!locationLabel) {
    return "기준 위치가 아직 지정되지 않았습니다.";
  }

  if (source === "device") {
    if (locationLabel === "현재 위치") {
      return "기준 위치: 현재 위치";
    }

    return `기준 위치: 현재 위치 · ${locationLabel}`;
  }

  if (locationLabel === "선택 위치") {
    return "기준 위치: 선택 위치";
  }

  return `기준 위치: 선택 위치 · ${locationLabel}`;
}

function getOptionLabel<T extends string | number>(
  options: Array<{ label: string; value: T }>,
  value: T
) {
  return options.find((option) => option.value === value)?.label ?? String(value);
}

export default function YomechuLauncher({
  open,
  locationStatus,
  locationSource,
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
  const showPresetSection = !hasBaseLocation;
  const statusLabel = getLocationStatusLabel(
    locationStatus,
    locationSource,
    hasBaseLocation
  );
  const statusDescription = getLocationDescription(
    locationStatus,
    locationSource,
    hasBaseLocation
  );
  const locationLine = getLocationLine(locationSource, locationLabel);
  const selectedCountLabel = getOptionLabel(YOMECHU_COUNT_OPTIONS, selectedCount);
  const selectedRadiusLabel = getOptionLabel(
    YOMECHU_RADIUS_OPTIONS,
    selectedRadius
  );
  const selectedCategoryLabel = getOptionLabel(
    YOMECHU_CATEGORY_OPTIONS,
    selectedCategory
  );
  const summaryPills = [
    {
      label: `${selectedCountLabel} 추천`,
      className: "bg-primary/10 text-primary ring-1 ring-primary/15",
    },
    {
      label: `${selectedRadiusLabel} 반경`,
      className: "bg-gray-100 text-gray-700 ring-1 ring-gray-200",
    },
    {
      label: selectedCategoryLabel === "전체" ? "전체 업종" : selectedCategoryLabel,
      className: "bg-secondary/15 text-sky-900 ring-1 ring-secondary/30",
    },
  ] as const;
  const selectionSummary = `${selectedCountLabel} 추천 · ${selectedRadiusLabel} · ${selectedCategoryLabel}`;
  const showRetryButton =
    !hasBaseLocation &&
    locationStatus !== "unsupported" &&
    locationStatus !== "loading";

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
          <div className="mx-auto max-w-lg px-4 pb-4 pt-3">
            <div className="flex max-h-[calc(100dvh-136px)] flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/95 shadow-[0_18px_40px_rgba(155,125,212,0.18)]">
              <div className="min-h-0 overflow-y-auto p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-primary/70">
                      오늘은 트렌드 말고 그냥 밥
                    </p>
                    <h2 className="mt-1 break-keep text-xl font-black tracking-[-0.04em] text-gray-900">
                      요메추
                    </h2>
                    <p className="mt-1 break-keep text-sm leading-5 text-gray-500">
                      추천 수, 거리, 업종만 고르면 바로 근처 맛집을 골라드려요.
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                      hasBaseLocation
                        ? "bg-primary/10 text-primary"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {hasBaseLocation ? "추천 준비 완료" : "기준 위치 필요"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {summaryPills.map((pill) => (
                    <span
                      key={pill.label}
                      className={`rounded-full px-3 py-2 text-sm font-semibold ${pill.className}`}
                    >
                      {pill.label}
                    </span>
                  ))}
                </div>

                <div
                  className={`mt-3 rounded-2xl border px-4 py-3 ${
                    hasBaseLocation
                      ? "border-gray-200 bg-gray-50"
                      : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            hasBaseLocation
                              ? "bg-white text-primary ring-1 ring-primary/15"
                              : "bg-white text-amber-700 ring-1 ring-amber-200"
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </div>

                      {hasBaseLocation ? (
                        <p className="mt-2 break-keep text-sm font-semibold leading-5 text-gray-900">
                          {locationLine}
                        </p>
                      ) : (
                        <>
                          <p className="mt-2 break-keep text-sm font-semibold leading-5 text-amber-900">
                            기준 위치를 먼저 정하면 주변 추천이 더 정확해져요.
                          </p>
                          <p className="mt-1 break-keep text-xs leading-5 text-amber-700">
                            {statusDescription}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                      <button
                        type="button"
                        onClick={onOpenLocationPicker}
                        className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                          hasBaseLocation
                            ? "border border-gray-200 bg-white text-gray-700 hover:border-primary hover:text-primary"
                            : "bg-amber-900 text-white hover:bg-amber-950"
                        }`}
                      >
                        {hasBaseLocation ? "위치 변경" : "위치 지정하기"}
                      </button>
                      {showRetryButton ? (
                        <button
                          type="button"
                          onClick={onRetryLocation}
                          className="text-xs font-semibold text-amber-700 transition-colors hover:text-amber-900"
                        >
                          현재 위치 다시 확인
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {showPresetSection ? (
                    <div className="mt-3">
                      <p className="mb-2 text-[11px] font-semibold tracking-[0.02em] text-amber-800">
                        빠른 지역 선택
                      </p>
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
                                  : "bg-white text-gray-700 ring-1 ring-amber-200 hover:bg-amber-100"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <section className="rounded-2xl border border-primary/10 bg-primary/5 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-700">추천 수</p>
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        {selectedCountLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {YOMECHU_COUNT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onCountChange(option.value)}
                          className={`rounded-2xl border px-0 py-3 text-sm font-semibold transition-all ${
                            selectedCount === option.value
                              ? "border-primary bg-primary text-white shadow-[0_10px_24px_rgba(155,125,212,0.24)]"
                              : "border-primary/15 bg-white text-primary hover:border-primary/35 hover:bg-primary/5"
                          }`}
                          aria-pressed={selectedCount === option.value}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-700">거리</p>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200">
                        {selectedRadiusLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {YOMECHU_RADIUS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onRadiusChange(option.value)}
                          className={`rounded-2xl border px-0 py-3 text-sm font-semibold transition-all ${
                            selectedRadius === option.value
                              ? "border-gray-950 bg-gray-950 text-white shadow-[0_10px_24px_rgba(17,24,39,0.18)]"
                              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-secondary/20 bg-secondary/10 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-sky-900">업종</p>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-900 ring-1 ring-secondary/30">
                        {selectedCategoryLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {YOMECHU_CATEGORY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onCategoryChange(option.value)}
                          className={`min-h-[44px] rounded-2xl border px-3 py-2 text-sm font-semibold transition-all ${
                            selectedCategory === option.value
                              ? "border-secondary bg-secondary text-white shadow-[0_10px_24px_rgba(139,172,216,0.3)]"
                              : "border-secondary/30 bg-white text-sky-900 hover:border-secondary/60 hover:bg-sky-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>

                {error ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600">
                    {error}
                  </div>
                ) : null}

                <div
                  className="sticky z-10 mt-4 -mx-4 border-t border-gray-100 bg-white/95 px-4 pb-4 pt-3 shadow-[0_-8px_24px_rgba(255,255,255,0.82)] backdrop-blur supports-[backdrop-filter]:bg-white/88"
                  style={{ bottom: "var(--launcher-footer-offset)" }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                    선택 조건
                  </p>
                  <p className="mt-1 break-keep text-sm font-semibold text-gray-900">
                    {selectionSummary}
                  </p>
                  <p
                    className={`mt-1 break-keep text-xs leading-5 ${
                      hasBaseLocation ? "text-gray-500" : "text-amber-700"
                    }`}
                  >
                    {hasBaseLocation
                      ? locationLine
                      : "기준 위치를 먼저 정해 주세요. 빠른 지역 선택도 사용할 수 있어요."}
                  </p>

                  <button
                    type="button"
                    onClick={onSpin}
                    disabled={!canSpin}
                    className="mt-3 w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    {getSpinButtonLabel(selectedCount, isSubmitting)}
                  </button>
                </div>
              </div>

            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
