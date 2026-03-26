import type { Metadata } from "next";
import MapPageClient from "./MapPageClient";
import KakaoSdkScripts from "@/components/KakaoSdkScripts";
import { buildMetadata } from "@/lib/seo";
import { getActiveTrends } from "@/lib/trends-server";

export const metadata: Metadata = buildMetadata({
  title: "내 주변 바이럴 음식 지도",
  description:
    "내 위치 주변 바이럴 음식 판매처를 지도에서 확인하고, 트렌드별로 가까운 매장을 찾아보세요.",
  path: "/map",
  keywords: ["바이럴 음식 지도", "주변 판매처", "카카오맵 맛집"],
});

export default async function MapPage() {
  const trends = await getActiveTrends();

  return (
    <>
      <KakaoSdkScripts />
      <MapPageClient initialTrends={trends} />
    </>
  );
}
