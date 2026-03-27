"use client";

import { useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";

import BottomNav from "@/components/BottomNav";
import Header from "@/components/Header";
import ShareButton from "@/components/ShareButton";
import { openExternalUrl } from "@/lib/external-links";
import type { SharedYomechuPlace } from "@/lib/yomechu-server";
import { sendYomechuFeedback } from "@/lib/crawler";

interface YomechuSharePageClientProps {
  spinId: string;
  poolSize: number;
  usedFallback: boolean;
  winners: SharedYomechuPlace[];
}

function WinnerListCard({
  place,
  rank,
  onOpenPlace,
}: {
  place: SharedYomechuPlace;
  rank: number;
  onOpenPlace: (place: SharedYomechuPlace) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenPlace(place)}
      className="w-full rounded-2xl border border-white/10 bg-white/7 p-3 text-left transition-colors hover:bg-white/12"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-xs font-bold text-white">
          {rank}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-keep text-sm font-semibold text-white">{place.name}</p>
            <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/18 px-3 py-1 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(155,125,212,0.2)] backdrop-blur-sm">
              {place.category_label}
            </span>
            {place.rating ? (
              <span className="rounded-full bg-amber-300/18 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
                평점 {place.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-keep text-xs leading-5 text-white/60">{place.address}</p>
          {place.trend_names.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {place.trend_names.slice(0, 3).map((trend) => (
                <span
                  key={trend}
                  className="rounded-full bg-primary/18 px-3 py-1 text-[11px] font-semibold text-white"
                >
                  {trend}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/75">
          지도 보기
        </span>
      </div>
    </button>
  );
}

export default function YomechuSharePageClient({
  spinId,
  poolSize,
  usedFallback,
  winners,
}: YomechuSharePageClientProps) {
  const primaryWinner = winners[0] ?? null;

  const handleTrackShare = useCallback(() => {
    if (!primaryWinner) {
      return;
    }

    void sendYomechuFeedback({
      spin_id: spinId,
      place_id: primaryWinner.place_id,
      event_type: "share",
    });
  }, [primaryWinner, spinId]);

  const handleOpenPlace = useCallback(
    (place: SharedYomechuPlace) => {
      void sendYomechuFeedback({
        spin_id: spinId,
        place_id: place.place_id,
        event_type: "open",
        payload: {
          place_url: place.place_url,
          source: "share_page",
        },
      });

      openExternalUrl(place.place_url);
    },
    [spinId]
  );

  if (!primaryWinner) {
    return (
      <>
        <Header />
        <main className="mx-auto flex max-w-lg flex-col gap-8 px-4 py-12">
          <section className="rounded-[32px] border border-white/20 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_35%),linear-gradient(160deg,_#111827_0%,_#160f2d_55%,_#10203c_100%)] px-6 py-8 text-center text-white shadow-[0_30px_80px_rgba(17,24,39,0.55)]">
            <p className="text-lg font-bold text-white">추천 결과를 불러오지 못했어요</p>
            <p className="mt-2 break-keep text-sm leading-6 text-white/68">
              공유된 요메추 결과 정보가 비어 있습니다.
            </p>
            <Link
              href="/?openYomechu=1"
              className="mt-5 inline-flex rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-5 py-3 text-sm font-black text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)]"
            >
              나도 추천받기
            </Link>
          </section>
        </main>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-lg px-4 py-4">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="rounded-[32px] border border-white/20 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_35%),linear-gradient(160deg,_#111827_0%,_#160f2d_55%,_#10203c_100%)] p-5 text-white shadow-[0_30px_80px_rgba(17,24,39,0.55)]"
        >
          <div className="flex flex-col gap-8">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
                  YOMECHU REVEAL
                </p>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/75">
                  추천 {winners.length}곳
                </span>
              </div>
              <h1 className="mt-2 break-keep text-2xl font-black tracking-[-0.05em] text-white">
                오늘 갈 곳을 정리해 드릴게요
              </h1>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/7 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
                  Winner
                </span>
                {usedFallback ? (
                  <span className="rounded-full bg-amber-300/18 px-2.5 py-1 text-[10px] font-semibold text-amber-100">
                    업종 후보가 적어서 전체 후보까지 확장했습니다
                  </span>
                ) : null}
              </div>

              <div className="rounded-[24px] border border-primary/45 bg-white/12 p-5 shadow-[0_16px_40px_rgba(155,125,212,0.26)]">
                <div className="inline-flex">
                  <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/18 px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-white shadow-[0_10px_22px_rgba(155,125,212,0.24)] backdrop-blur-sm">
                    {primaryWinner.category_label}
                  </span>
                </div>
                <h2 className="mt-2 break-keep text-[28px] font-black tracking-[-0.05em] text-white sm:text-[30px]">
                  {primaryWinner.name}
                </h2>
                <p className="mt-2 break-keep text-sm leading-6 text-white/70">
                  {primaryWinner.address}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                    후보 {poolSize}곳
                  </span>
                  {primaryWinner.rating ? (
                    <span className="rounded-full bg-amber-300/18 px-3 py-1 text-xs font-semibold text-amber-100">
                      평점 {primaryWinner.rating.toFixed(1)}
                    </span>
                  ) : null}
                  {primaryWinner.trend_names.slice(0, 3).map((trend) => (
                    <span
                      key={trend}
                      className="rounded-full bg-primary/18 px-3 py-1 text-xs font-semibold text-white"
                    >
                      {trend}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
              <span>후보 {poolSize}곳</span>
              <span>추천 정리 완료</span>
            </div>

            {winners.length > 1 ? (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
                  추천 리스트 · {winners.length}곳
                </p>
                <div className="flex flex-col gap-8">
                  {winners.map((place, index) => (
                    <WinnerListCard
                      key={place.place_id}
                      place={place}
                      rank={index + 1}
                      onOpenPlace={handleOpenPlace}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className="flex justify-center">
                <ShareButton
                  title={
                    winners.length > 1
                      ? `${primaryWinner.name} 포함 ${winners.length}곳 추천 - 요즘뭐먹`
                      : `${primaryWinner.name} 추천 - 요즘뭐먹`
                  }
                  description={`${primaryWinner.name} 추천 결과를 요즘뭐먹에서 확인해보세요.`}
                  shareLabel="재공유"
                  onShare={handleTrackShare}
                />
              </div>
              <button
                type="button"
                onClick={() => handleOpenPlace(primaryWinner)}
                className="w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)]"
              >
                {winners.length > 1 ? "1순위 지도에서 보기" : "지도에서 보기"}
              </button>
              <Link
                href="/?openYomechu=1"
                className="flex w-full items-center justify-center rounded-2xl border border-white/14 bg-white/8 px-4 py-3 text-sm font-semibold text-white/82 transition-colors hover:bg-white/12"
              >
                나도 추천받기
              </Link>
            </div>
          </div>
        </motion.section>
      </main>
      <BottomNav />
    </>
  );
}
