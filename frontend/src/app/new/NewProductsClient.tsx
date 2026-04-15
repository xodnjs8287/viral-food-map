"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

import NewProductCard from "@/components/NewProductCard";
import {
  deriveNewProductsView,
  type NewProductBrandOption,
  type NewProductListItem,
  type NewProductsPeriod,
  type NewProductsViewData,
} from "@/lib/new-products";
import type {
  NewProductSectorFilter,
  NewProductSectorKey,
} from "@/lib/new-product-taxonomy";

import {
  PERIOD_OPTIONS,
  SECTOR_OPTIONS,
  buildFilterHref,
  getPeriodLabel,
  getSectorLabel,
} from "./filters";

const PAGE_SIZE = 12;

type DropdownKey = "period";
type CatalogStatus = "idle" | "loading" | "ready" | "failed";
type FilterMode = "server" | "client";
type CatalogResponse = {
  products: NewProductListItem[];
  lastUpdated: string | null;
};

interface NewProductsClientProps {
  initialProducts: NewProductListItem[];
  initialSectorCounts: Record<NewProductSectorKey, number>;
  initialBrandOptions: NewProductBrandOption[];
  initialBrandCount: number;
  initialTotalCount: number;
  initialLastUpdated: string | null;
  initialPeriod: NewProductsPeriod;
  initialSector: NewProductSectorFilter;
  initialBrand: string | null;
}

interface FilterDropdownProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (next: T) => void;
}

interface FilterState {
  period: NewProductsPeriod;
  sector: NewProductSectorFilter;
  brand: string | null;
}

type IdleCapableWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: () => void) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

let catalogRequestPromise: Promise<CatalogResponse> | null = null;

function fetchNewProductsCatalog() {
  if (!catalogRequestPromise) {
    catalogRequestPromise = fetch("/api/new-products/catalog")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch new products catalog.");
        }

        return (await response.json()) as CatalogResponse;
      })
      .catch((error) => {
        catalogRequestPromise = null;
        throw error;
      });
  }

  return catalogRequestPromise;
}

function scheduleIdleTask(callback: () => void) {
  const idleWindow = window as IdleCapableWindow;

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(callback);
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const timeoutId = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeoutId);
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "방금";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "방금";
  }

  return parsed.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ChevronDown() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterDropdown<T extends string>({
  label,
  value,
  options,
  open,
  onOpen,
  onClose,
  onSelect,
}: FilterDropdownProps<T>) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  const current =
    options.find((option) => option.key === value)?.label ?? options[0]?.label;

  return (
    <div className="flex-1">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <div ref={wrapperRef} className="relative mt-1.5">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? onClose() : onOpen())}
          className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-gray-900 ring-1 ring-gray-200 transition-colors hover:ring-primary"
        >
          <span>{current}</span>
          <ChevronDown />
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-gray-100"
          >
            {options.map((option) => {
              const active = option.key === value;
              return (
                <li
                  key={option.key}
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(option.key)}
                  className={`cursor-pointer px-3.5 py-2 text-sm transition-colors ${
                    active
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function NewProductsClient({
  initialProducts,
  initialSectorCounts,
  initialBrandOptions,
  initialBrandCount,
  initialTotalCount,
  initialLastUpdated,
  initialPeriod,
  initialSector,
  initialBrand,
}: NewProductsClientProps) {
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const initialView = useMemo<NewProductsViewData>(
    () => ({
      products: initialProducts,
      sectorCounts: initialSectorCounts,
      brandOptions: initialBrandOptions,
      brandCount: initialBrandCount,
      totalCount: initialTotalCount,
      selectedBrand: initialBrand,
    }),
    [
      initialProducts,
      initialSectorCounts,
      initialBrandOptions,
      initialBrandCount,
      initialTotalCount,
      initialBrand,
    ]
  );

  const [filters, setFilters] = useState<FilterState>({
    period: initialPeriod,
    sector: initialSector,
    brand: initialBrand,
  });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("idle");
  const [filterMode, setFilterMode] = useState<FilterMode>("server");
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null);

  useEffect(() => {
    setFilters({
      period: initialPeriod,
      sector: initialSector,
      brand: initialBrand,
    });
    setFilterMode("server");
  }, [initialPeriod, initialSector, initialBrand, initialTotalCount]);

  useEffect(() => {
    let cancelled = false;

    setCatalogStatus((current) => (current === "ready" ? current : "loading"));

    const cancelScheduledTask = scheduleIdleTask(() => {
      void fetchNewProductsCatalog()
        .then((data) => {
          if (cancelled) {
            return;
          }

          setCatalogData(data);
          setCatalogStatus("ready");
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setCatalogStatus("failed");
        });
    });

    return () => {
      cancelled = true;
      cancelScheduledTask();
    };
  }, []);

  const clientView = useMemo(() => {
    if (filterMode !== "client" || !catalogData) {
      return null;
    }

    return deriveNewProductsView(catalogData.products, filters);
  }, [catalogData, filterMode, filters]);

  const currentView = clientView ?? initialView;
  const currentPeriod = filterMode === "client" ? filters.period : initialPeriod;
  const currentSector = filterMode === "client" ? filters.sector : initialSector;
  const currentBrand = currentView.selectedBrand;
  const currentLastUpdated =
    filterMode === "client"
      ? catalogData?.lastUpdated ?? initialLastUpdated
      : initialLastUpdated;
  const totalSectorCount = useMemo(
    () => Object.values(currentView.sectorCounts).reduce((sum, value) => sum + value, 0),
    [currentView.sectorCounts]
  );
  const visibleProducts = useMemo(
    () => currentView.products.slice(0, visibleCount),
    [currentView.products, visibleCount]
  );
  const sectorSummary = useMemo(
    () =>
      SECTOR_OPTIONS.filter(
        (
          option
        ): option is {
          key: NewProductSectorKey;
          label: string;
        } => option.key !== "all" && currentView.sectorCounts[option.key] > 0
      ),
    [currentView.sectorCounts]
  );
  const visibleSectorHighlights = sectorSummary.slice(0, 3);
  const selectedBrandLabel =
    currentView.brandOptions.find((option) => option.key === currentBrand)?.label ??
    currentBrand;
  const hasMore = visibleCount < currentView.products.length;

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [currentPeriod, currentSector, currentBrand, filterMode]);

  useEffect(() => {
    if (!hasMore) return;

    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((current) =>
            Math.min(current + PAGE_SIZE, currentView.products.length)
          );
        }
      },
      { rootMargin: "400px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [currentView.products.length, hasMore]);

  const applyFilter = (
    nextPeriod: NewProductsPeriod,
    nextSector: NewProductSectorFilter,
    nextBrand: string | null = currentBrand
  ) => {
    const requestedFilters: FilterState = {
      period: nextPeriod,
      sector: nextSector,
      brand: nextSector === "all" ? null : nextBrand,
    };

    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    setOpenDropdown(null);

    if (catalogStatus !== "ready" || !catalogData) {
      router.replace(
        buildFilterHref(
          requestedFilters.period,
          requestedFilters.sector,
          requestedFilters.brand
        ),
        { scroll: false }
      );
      return;
    }

    const nextView = deriveNewProductsView(catalogData.products, requestedFilters);
    const nextFilters: FilterState = {
      ...requestedFilters,
      brand: nextView.selectedBrand,
    };

    startTransition(() => {
      setFilterMode("client");
      setFilters(nextFilters);
    });

    window.history.replaceState(
      {},
      "",
      buildFilterHref(nextFilters.period, nextFilters.sector, nextFilters.brand)
    );
  };

  return (
    <>
      <section className="mb-6">
        <div className="rounded-2xl bg-gradient-to-br from-purple-400 to-blue-400 px-6 py-6 text-white">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-white/90">
            <span className="rounded-full bg-white/15 px-2.5 py-1">
              공식 신상 {currentView.totalCount}개
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1">
              브랜드 {currentView.brandCount}곳
            </span>
            {visibleSectorHighlights.map((option) => (
              <span
                key={option.key}
                className="rounded-full bg-white/15 px-2.5 py-1"
              >
                {option.label} {currentView.sectorCounts[option.key]}개
              </span>
            ))}
          </div>

          <p className="mt-4 text-xl font-bold leading-snug">
            프랜차이즈 신상,
            <br />
            업종과 브랜드별로 빠르게 확인
          </p>

          <p className="mt-2 text-sm leading-relaxed text-white/85">
            공식 상품 페이지와 브랜드 채널에서 음식 위주 신상만 골라서
            보여드립니다.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/"
              prefetch={false}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-purple-50"
            >
              홈 트렌드 보기
            </Link>
            <button
              type="button"
              onClick={() => applyFilter("all", currentSector, currentBrand)}
              className="rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              전체 기간 보기
            </button>
          </div>

          <p className="mt-4 text-xs text-white/80">
            마지막 수집: {formatUpdatedAt(currentLastUpdated)}
          </p>
        </div>
      </section>

      <section className="mb-6">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-gray-900">필터</h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                기간별 프랜차이즈 신상을 업종과 브랜드 기준으로 다시
                정리해 보여줍니다.
              </p>
            </div>
            <div className="shrink-0 text-right text-xs text-gray-400">
              <p>{currentView.totalCount}개 노출</p>
              <p className="mt-1">브랜드 {currentView.brandCount}곳</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <FilterDropdown
              label="기간"
              value={currentPeriod}
              options={PERIOD_OPTIONS}
              open={openDropdown === "period"}
              onOpen={() => setOpenDropdown("period")}
              onClose={() =>
                setOpenDropdown((current) => (current === "period" ? null : current))
              }
              onSelect={(next) => applyFilter(next, currentSector, currentBrand)}
            />
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500">업종</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SECTOR_OPTIONS.map((option) => {
                const active = currentSector === option.key;
                const count =
                  option.key === "all"
                    ? totalSectorCount
                    : currentView.sectorCounts[option.key];

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyFilter(currentPeriod, option.key, null)}
                    className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? "bg-primary text-white"
                        : "bg-primary/10 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {option.label} {count}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-gray-500">브랜드</p>
              {currentSector !== "all" ? (
                <span className="text-[11px] text-gray-400">
                  {currentView.brandOptions.length}개 브랜드
                </span>
              ) : null}
            </div>

            {currentSector === "all" ? (
              <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
                업종을 먼저 고르면 스타벅스, 맥도날드처럼 브랜드별로 더 빠르게
                좁혀볼 수 있어요.
              </p>
            ) : currentView.brandOptions.length === 0 ? (
              <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                이 업종에는 아직 노출 중인 브랜드가 없습니다.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyFilter(currentPeriod, currentSector, null)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                    !currentBrand
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  전체 브랜드
                </button>
                {currentView.brandOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyFilter(currentPeriod, currentSector, option.key)}
                    className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                      currentBrand === option.key
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {option.label} {option.count}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-gray-400">
            {sectorSummary.map((option) => (
              <span key={option.key}>
                {option.label} {currentView.sectorCounts[option.key]}개
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">신상 목록</h3>
            <p className="mt-1 text-xs text-gray-500">
              {getPeriodLabel(currentPeriod)} · {getSectorLabel(currentSector)} 기준
              {selectedBrandLabel ? ` · ${selectedBrandLabel}` : ""}
            </p>
          </div>
          <span className="text-xs text-gray-400">{currentView.totalCount}개</span>
        </div>

        {currentView.products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
            <p className="mb-4 text-5xl">🍽️</p>
            <p className="text-base font-semibold text-gray-900">
              조건에 맞는 신상이 아직 없습니다
            </p>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              기간을 넓히거나 업종, 브랜드 필터를 바꿔보세요. 공식 채널 기준
              데이터만 보여드립니다.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-8">
              {visibleProducts.map((product) => (
                <NewProductCard key={product.id} product={product} />
              ))}
            </div>

            <div ref={sentinelRef} aria-hidden="true" className="h-8 w-full" />

            {hasMore ? (
              <p className="py-4 text-center text-xs text-gray-400">
                불러오는 중…
              </p>
            ) : (
              <p className="py-4 text-center text-xs text-gray-300">
                마지막까지 모두 확인했어요
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
