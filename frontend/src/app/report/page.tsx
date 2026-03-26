import type { Metadata } from "next";
import ReportPageClient from "./ReportPageClient";
import KakaoSdkScripts from "@/components/KakaoSdkScripts";
import { buildMetadata } from "@/lib/seo";
import { getActiveTrends } from "@/lib/trends-server";

export const metadata: Metadata = buildMetadata({
  title: "판매처 제보하기",
  description:
    "유행 음식을 파는 매장을 제보하면 검토 후 요즘뭐먹 지도에 반영됩니다.",
  path: "/report",
  keywords: ["맛집 제보", "판매처 제보", "바이럴 음식 제보"],
});

export default async function ReportPage() {
  const trends = await getActiveTrends();

  return (
    <>
      <KakaoSdkScripts />
      <ReportPageClient initialTrends={trends} />
    </>
  );
}
