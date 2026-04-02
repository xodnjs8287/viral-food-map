import type { Metadata } from "next";
import KakaoSdkScripts from "@/components/KakaoSdkScripts";
import TrendDetailPageClient from "./TrendDetailPageClient";
import { buildMetadata, buildTrendDescription } from "@/lib/seo";
import { getTrendDetailById } from "@/lib/trends-server";

export const revalidate = 3600;

interface TrendPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: TrendPageProps): Promise<Metadata> {
  const { id } = await params;
  const trendData = await getTrendDetailById(id);

  if (!trendData) {
    return buildMetadata({
      title: "트렌드를 찾을 수 없어요",
      description: "요청한 트렌드 정보를 찾을 수 없습니다.",
      path: `/trend/${id}`,
      noIndex: true,
    });
  }

  return buildMetadata({
    title: `${trendData.trend.name} 판매처 지도`,
    description: buildTrendDescription({
      name: trendData.trend.name,
      description: trendData.trend.description,
      storeCount: trendData.trend.store_count,
      detectedAt: trendData.trend.detected_at,
    }),
    path: `/trend/${id}`,
    image: trendData.trend.image_url,
    keywords: [
      trendData.trend.name,
      `${trendData.trend.name} 판매처`,
      `${trendData.trend.name} 지도`,
      `${trendData.trend.name} 맛집`,
    ],
  });
}

export default async function TrendDetailPage({ params }: TrendPageProps) {
  const { id } = await params;
  const trendData = await getTrendDetailById(id);

  return (
    <>
      <KakaoSdkScripts />
      <TrendDetailPageClient
        id={id}
        initialTrend={trendData?.trend ?? null}
        initialStores={trendData?.stores ?? []}
      />
    </>
  );
}
