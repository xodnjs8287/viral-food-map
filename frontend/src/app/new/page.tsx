import Link from "next/link";
import type { Metadata } from "next";

import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import NewProductCard from "@/components/NewProductCard";
import {
  getNewProductsPageData,
  type NewProductsPeriod,
  type NewProductsSourceFilter,
} from "@/lib/new-products-server";
import { buildMetadata } from "@/lib/seo";

interface NewProductsPageProps {
  searchParams?: {
    period?: string;
    source?: string;
  };
}

const PERIOD_OPTIONS: Array<{ key: NewProductsPeriod; label: string }> = [
  { key: "1d", label: "오늘" },
  { key: "3d", label: "3일" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "all", label: "전체" },
];

const SOURCE_OPTIONS: Array<{ key: NewProductsSourceFilter; label: string }> = [
  { key: "all", label: "전체" },
  { key: "convenience", label: "편의점" },
  { key: "franchise", label: "프랜차이즈" },
];

export const metadata: Metadata = buildMetadata({
  title: "신상 음식 모아보기",
  description:
    "편의점과 프랜차이즈의 공식 채널에서 음식 위주 신상과 신메뉴를 기간별로 모아봅니다.",
  path: "/new",
  keywords: ["신상 음식", "편의점 신상", "프랜차이즈 신메뉴", "신상 메뉴"],
});

function normalizePeriod(period?: string): NewProductsPeriod {
  return PERIOD_OPTIONS.some((option) => option.key === period)
    ? (period as NewProductsPeriod)
    : "7d";
}

function normalizeSource(source?: string): NewProductsSourceFilter {
  return SOURCE_OPTIONS.some((option) => option.key === source)
    ? (source as NewProductsSourceFilter)
    : "all";
}

function buildFilterHref(
  period: NewProductsPeriod,
  source: NewProductsSourceFilter
) {
  const params = new URLSearchParams();

  if (period !== "7d") {
    params.set("period", period);
  }

  if (source !== "all") {
    params.set("source", source);
  }

  const query = params.toString();
  return query ? `/new?${query}` : "/new";
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

function getPeriodLabel(period: NewProductsPeriod) {
  return PERIOD_OPTIONS.find((option) => option.key === period)?.label ?? "7일";
}

function getSourceLabel(source: NewProductsSourceFilter) {
  return SOURCE_OPTIONS.find((option) => option.key === source)?.label ?? "전체";
}

export const revalidate = 300;

export default async function NewProductsPage({
  searchParams,
}: NewProductsPageProps) {
  const period = normalizePeriod(searchParams?.period);
  const source = normalizeSource(searchParams?.source);
  const pageData = await getNewProductsPageData({ period, sourceType: source });

  return (
    <>
      <Header />

      <main className="page-with-bottom-nav max-w-lg mx-auto px-4 py-4">
        <section className="mb-6">
          <div className="rounded-2xl bg-gradient-to-br from-purple-400 to-blue-400 px-6 py-6 text-white">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-white/90">
              <span className="rounded-full bg-white/15 px-2.5 py-1">
                공식 신상 {pageData.totalCount}개
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-1">
                편의점 {pageData.sourceCounts.convenience}개
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-1">
                프랜차이즈 {pageData.sourceCounts.franchise}개
              </span>
            </div>

            <p className="mt-4 text-xl font-bold leading-snug">
              편의점과 프랜차이즈 신상,
              <br />
              한 화면에서 기간별로 확인
            </p>

            <p className="mt-2 text-sm leading-relaxed text-white/85">
              공식 상품 페이지와 브랜드 이벤트 채널에서 음식 위주 신상만 골라서
              보여드립니다.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/"
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-purple-50"
              >
                홈 트렌드 보기
              </Link>
              <Link
                href={buildFilterHref("all", source)}
                className="rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                전체 기간 보기
              </Link>
            </div>

            <p className="mt-4 text-xs text-white/80">
              마지막 수집: {formatUpdatedAt(pageData.lastUpdated)}
            </p>
          </div>
        </section>

        <section className="mb-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900">필터</h2>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  기간과 출처를 바꾸면 공식 채널 기준 신상만 다시 정리해 보여줍니다.
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium text-gray-400">
                {pageData.totalCount}개 노출
              </span>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-900">기간</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PERIOD_OPTIONS.map((option) => {
                  const active = option.key === period;

                  return (
                    <Link
                      key={option.key}
                      href={buildFilterHref(option.key, source)}
                      className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-gray-900 text-white"
                          : "bg-white text-gray-500 ring-1 ring-gray-200 hover:text-primary"
                      }`}
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-gray-900">출처</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((option) => {
                  const active = option.key === source;

                  return (
                    <Link
                      key={option.key}
                      href={buildFilterHref(period, option.key)}
                      className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-primary text-white"
                          : "bg-white text-gray-500 ring-1 ring-gray-200 hover:text-primary"
                      }`}
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-900">신상 목록</h3>
              <p className="mt-1 text-xs text-gray-500">
                {getPeriodLabel(period)} · {getSourceLabel(source)} 기준
              </p>
            </div>
            <span className="text-xs text-gray-400">{pageData.totalCount}개</span>
          </div>

          {pageData.products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
              <p className="mb-4 text-5xl">🍽️</p>
              <p className="text-base font-semibold text-gray-900">
                조건에 맞는 신상이 아직 없습니다
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                기간을 넓히거나 출처 필터를 바꿔보세요. 공식 채널 기준 데이터만
                보여드립니다.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {pageData.products.map((product) => (
                <NewProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>

        <Footer />
      </main>

      <BottomNav />
    </>
  );
}
