import Link from "next/link";
import type { Metadata } from "next";

import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { getNewProductsPageData } from "@/lib/new-products-server";
import { buildMetadata } from "@/lib/seo";

import NewProductsClient from "./NewProductsClient";
import {
  buildFilterHref,
  normalizePeriod,
  normalizeSource,
} from "./filters";

interface NewProductsPageProps {
  searchParams?: Promise<{
    period?: string;
    source?: string;
  }>;
}

export const metadata: Metadata = buildMetadata({
  title: "신상 음식 모아보기",
  description:
    "편의점과 프랜차이즈의 공식 채널에서 음식 위주 신상과 신메뉴를 기간별로 모아봅니다.",
  path: "/new",
  keywords: ["신상 음식", "편의점 신상", "프랜차이즈 신메뉴", "신상 메뉴"],
});

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

export const revalidate = 300;

export default async function NewProductsPage({
  searchParams,
}: NewProductsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const period = normalizePeriod(resolvedSearchParams.period);
  const source = normalizeSource(resolvedSearchParams.source);
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

        <NewProductsClient
          initialProducts={pageData.products}
          totalCount={pageData.totalCount}
          sourceCounts={pageData.sourceCounts}
          period={period}
          source={source}
        />

        <Footer />
      </main>

      <BottomNav />
    </>
  );
}
