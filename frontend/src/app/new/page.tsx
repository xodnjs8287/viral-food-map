import type { Metadata } from "next";

import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { getNewProductsPageData } from "@/lib/new-products-server";
import { buildMetadata } from "@/lib/seo";

import NewProductsClient from "./NewProductsClient";
import { normalizeBrand, normalizePeriod, normalizeSector } from "./filters";

interface NewProductsPageProps {
  searchParams?: Promise<{
    period?: string;
    sector?: string;
    brand?: string;
    source?: string;
  }>;
}

export const metadata: Metadata = buildMetadata({
  title: "신상 음식 모아보기",
  description:
    "프랜차이즈 공식 채널의 신상 메뉴를 업종과 브랜드별로 모아봅니다.",
  path: "/new",
  keywords: ["신상 음식", "프랜차이즈 신메뉴", "브랜드 신상", "신상 메뉴"],
});

export const revalidate = 300;

export default async function NewProductsPage({
  searchParams,
}: NewProductsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const period = normalizePeriod(resolvedSearchParams.period);
  const sector = normalizeSector(resolvedSearchParams.sector);
  const brand = normalizeBrand(resolvedSearchParams.brand);
  const pageData = await getNewProductsPageData({ period, sector, brand });

  return (
    <>
      <Header />

      <main className="page-with-bottom-nav max-w-lg mx-auto px-4 py-4">
        <NewProductsClient
          initialProducts={pageData.products}
          initialSectorCounts={pageData.sectorCounts}
          initialBrandOptions={pageData.brandOptions}
          initialBrandCount={pageData.brandCount}
          initialTotalCount={pageData.totalCount}
          initialLastUpdated={pageData.lastUpdated}
          initialPeriod={period}
          initialSector={sector}
          initialBrand={pageData.selectedBrand}
        />

        <Footer />
      </main>

      <BottomNav />
    </>
  );
}
