import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import { buildMetadata } from "@/lib/seo";
import { getHomePageData } from "@/lib/trends-server";

export const metadata: Metadata = buildMetadata({
  title: "지금 유행하는 음식, 어디서 살까?",
  description:
    "SNS에서 뜨는 바이럴 음식 트렌드를 실시간으로 확인하고 내 주변 판매처를 바로 찾아보세요.",
  path: "/",
  keywords: ["실시간 음식 트렌드", "바이럴 음식 지도", "주변 판매처"],
});

export default async function HomePage() {
  const homePageData = await getHomePageData();

  return (
    <HomePageClient
      initialTrends={homePageData.trends}
      verifiedStoreCount={homePageData.verifiedStoreCount}
      lastUpdated={homePageData.lastUpdated}
    />
  );
}
