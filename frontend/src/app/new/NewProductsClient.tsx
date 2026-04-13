"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

import NewProductCard from "@/components/NewProductCard";
import type {
  NewProductBrandOption,
  NewProductListItem,
  NewProductsPeriod,
} from "@/lib/new-products-server";
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

interface NewProductsClientProps {
  initialProducts: NewProductListItem[];
  totalCount: number;
  sectorCounts: Record<NewProductSectorKey, number>;
  brandOptions: NewProductBrandOption[];
  brandCount: number;
  period: NewProductsPeriod;
  sector: NewProductSectorFilter;
  brand: string | null;
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
  totalCount,
  sectorCounts,
  brandOptions,
  brandCount,
  period,
  sector,
  brand,
}: NewProductsClientProps) {
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);

  // 필터가 바뀌면 페이지네이션 리셋
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [period, sector, brand]);

  const hasMore = visibleCount < initialProducts.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((current) =>
            Math.min(current + PAGE_SIZE, initialProducts.length)
          );
        }
      },
      { rootMargin: "400px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, initialProducts.length]);

  const applyFilter = (
    nextPeriod: NewProductsPeriod,
    nextSector: NewProductSectorFilter,
    nextBrand: string | null = brand
  ) => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    setOpenDropdown(null);
    router.push(buildFilterHref(nextPeriod, nextSector, nextBrand), {
      scroll: false,
    });
  };

  const visibleProducts = initialProducts.slice(0, visibleCount);
  const sectorSummary = SECTOR_OPTIONS.filter(
    (
      option
    ): option is {
      key: NewProductSectorKey;
      label: string;
    } => option.key !== "all" && sectorCounts[option.key] > 0
  );
  const selectedBrandLabel =
    brandOptions.find((option) => option.key === brand)?.label ?? brand;

  return (
    <>
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
              <p>{totalCount}개 노출</p>
              <p className="mt-1">브랜드 {brandCount}곳</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <FilterDropdown
              label="기간"
              value={period}
              options={PERIOD_OPTIONS}
              open={openDropdown === "period"}
              onOpen={() => setOpenDropdown("period")}
              onClose={() =>
                setOpenDropdown((current) =>
                  current === "period" ? null : current
                )
              }
              onSelect={(next) => applyFilter(next, sector, brand)}
            />
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500">업종</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SECTOR_OPTIONS.map((option) => {
                const active = sector === option.key;
                const count =
                  option.key === "all"
                    ? Object.values(sectorCounts).reduce(
                        (sum, value) => sum + value,
                        0
                      )
                    : sectorCounts[option.key];

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyFilter(period, option.key, null)}
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
              {sector !== "all" ? (
                <span className="text-[11px] text-gray-400">
                  {brandOptions.length}개 브랜드
                </span>
              ) : null}
            </div>

            {sector === "all" ? (
              <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
                업종을 먼저 고르면 스타벅스, 맥도날드처럼 브랜드별로 더 빠르게
                좁혀볼 수 있어요.
              </p>
            ) : brandOptions.length === 0 ? (
              <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                이 업종에는 아직 노출 중인 브랜드가 없습니다.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyFilter(period, sector, null)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                    !brand
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  전체 브랜드
                </button>
                {brandOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyFilter(period, sector, option.key)}
                    className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                      brand === option.key
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
                {option.label} {sectorCounts[option.key]}개
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
              {getPeriodLabel(period)} · {getSectorLabel(sector)} 기준
              {selectedBrandLabel ? ` · ${selectedBrandLabel}` : ""}
            </p>
          </div>
          <span className="text-xs text-gray-400">{totalCount}개</span>
        </div>

        {initialProducts.length === 0 ? (
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

            <div
              ref={sentinelRef}
              aria-hidden="true"
              className="h-8 w-full"
            />

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
