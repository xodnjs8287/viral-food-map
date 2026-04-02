import type { Metadata } from "next";
import { notFound } from "next/navigation";

import KakaoSdkScripts from "@/components/KakaoSdkScripts";
import { buildMetadata } from "@/lib/seo";
import {
  buildYomechuShareDescription,
  getSharedYomechuSpinById,
} from "@/lib/yomechu-server";
import YomechuSharePageClient from "./YomechuSharePageClient";

export const revalidate = 3600;

interface YomechuSharePageProps {
  params: Promise<{
    spinId: string;
  }>;
}

export async function generateMetadata({
  params,
}: YomechuSharePageProps): Promise<Metadata> {
  const { spinId } = await params;
  const sharedSpin = await getSharedYomechuSpinById(spinId);

  if (!sharedSpin?.primaryWinner) {
    return buildMetadata({
      title: "요메추 추천 결과를 찾을 수 없어요",
      description: "공유된 요메추 추천 결과를 찾을 수 없습니다.",
      path: `/yomechu/share/${spinId}`,
      noIndex: true,
    });
  }

  return buildMetadata({
    title:
      sharedSpin.winners.length > 1
        ? `${sharedSpin.primaryWinner.name} 포함 ${sharedSpin.winners.length}곳 추천`
        : `${sharedSpin.primaryWinner.name} 추천 결과`,
    description: buildYomechuShareDescription(
      sharedSpin.primaryWinner,
      sharedSpin.winners.length
    ),
    path: `/yomechu/share/${spinId}`,
    noIndex: true,
  });
}

export default async function YomechuSharePage({
  params,
}: YomechuSharePageProps) {
  const { spinId } = await params;
  const sharedSpin = await getSharedYomechuSpinById(spinId);

  if (!sharedSpin) {
    notFound();
  }

  return (
    <>
      <KakaoSdkScripts />
      <YomechuSharePageClient
        spinId={sharedSpin.spin.id}
        poolSize={sharedSpin.spin.pool_size}
        usedFallback={sharedSpin.spin.used_fallback}
        winners={sharedSpin.winners}
      />
    </>
  );
}
