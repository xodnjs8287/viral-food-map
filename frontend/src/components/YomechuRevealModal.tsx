"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { formatDistanceMeters } from "@/lib/crawler";
import { playFireworkHaptics } from "@/lib/haptics";
import type { YomechuPlace, YomechuSpinResponse } from "@/lib/types";
import EmojiConfetti from "@/components/EmojiConfetti";
import ShareButton from "@/components/ShareButton";

interface YomechuRevealModalProps {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  result: YomechuSpinResponse | null;
  onBack: () => void;
  onClose: () => void;
  onReroll: () => void;
  onOpenPlace: (place: YomechuPlace) => void;
  onShare?: () => void;
  shareUrl?: string | null;
}

type RevealPhase = "idle" | "fast" | "slow" | "winner";

function getPhaseCopy(phase: RevealPhase, isLoading: boolean) {
  if (isLoading) {
    return "근처 후보를 정리하는 중입니다.";
  }

  switch (phase) {
    case "fast":
      return "후보를 빠르게 훑는 중입니다.";
    case "slow":
      return "마지막 추천 결과를 좁히는 중입니다.";
    case "winner":
      return "오늘 갈 곳을 정리했습니다.";
    default:
      return "추천 후보를 준비하고 있습니다.";
  }
}

function ResultRow({
  place,
  index,
  onOpenPlace,
}: {
  place: YomechuPlace;
  index: number;
  onOpenPlace: (place: YomechuPlace) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenPlace(place)}
      className="w-full rounded-2xl border border-white/10 bg-white/7 p-3 text-left transition-colors hover:bg-white/12"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-xs font-bold text-white">
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-keep text-sm font-semibold text-white">{place.name}</p>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75">
              {formatDistanceMeters(place.distance_m)}
            </span>
          </div>
          <p className="mt-1 break-keep text-xs leading-5 text-white/60">
            {place.address}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/18 px-3 py-1 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(155,125,212,0.2)] backdrop-blur-sm">
              {place.category_label}
            </span>
            {place.rating ? (
              <span className="rounded-full bg-amber-300/18 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
                평점 {place.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
        </div>

        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/75">
          지도 보기
        </span>
      </div>
    </button>
  );
}

export default function YomechuRevealModal({
  isOpen,
  isLoading,
  error,
  result,
  onBack,
  onClose,
  onReroll,
  onOpenPlace,
  onShare,
  shareUrl,
}: YomechuRevealModalProps) {
  const winners = useMemo(() => {
    if (!result) {
      return [];
    }

    if (Array.isArray(result.winners) && result.winners.length > 0) {
      return result.winners;
    }

    return [result.winner];
  }, [result]);

  const primaryWinner = winners[0] ?? null;

  const reel = useMemo(() => {
    if (!result) {
      return [];
    }

    if (result.reel.length > 0) {
      return result.reel;
    }

    return primaryWinner ? [primaryWinner] : [];
  }, [primaryWinner, result]);

  const [phase, setPhase] = useState<RevealPhase>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const scrollY = window.scrollY;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyPosition = document.body.style.position;
    const originalBodyTop = document.body.style.top;
    const originalBodyWidth = document.body.style.width;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.position = originalBodyPosition;
      document.body.style.top = originalBodyTop;
      document.body.style.width = originalBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !primaryWinner || reel.length === 0) {
      setPhase("idle");
      setCurrentIndex(0);
      return;
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let cleanupHaptics: (() => void) | null = null;
    let elapsed = 0;
    let frame = 0;

    setPhase("fast");
    setCurrentIndex(0);

    for (let index = 0; index < 12; index += 1) {
      elapsed += 80;
      timeouts.push(
        setTimeout(() => {
          setPhase("fast");
          setCurrentIndex(frame % reel.length);
          frame += 1;
        }, elapsed)
      );
    }

    for (const delay of [160, 200, 240, 300, 360, 420]) {
      elapsed += delay;
      timeouts.push(
        setTimeout(() => {
          setPhase("slow");
          setCurrentIndex(frame % reel.length);
          frame += 1;
        }, elapsed)
      );
    }

    elapsed += 300;
    timeouts.push(
      setTimeout(() => {
        setPhase("winner");
        setCurrentIndex(Math.max(reel.length - 1, 0));
        cleanupHaptics?.();
        cleanupHaptics = playFireworkHaptics();
      }, elapsed)
    );

    return () => {
      timeouts.forEach(clearTimeout);
      cleanupHaptics?.();
    };
  }, [isOpen, primaryWinner, reel]);

  const activePlace = phase === "winner" ? primaryWinner : (reel[currentIndex] ?? primaryWinner);

  const confettiFired = phase === "winner" && isOpen;

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end justify-center overflow-hidden bg-gray-950/55 px-4 backdrop-blur-sm sm:items-center"
          style={{
            paddingTop: "calc(var(--safe-top) + 16px)",
            paddingBottom: "calc(var(--safe-bottom) + 16px)",
          }}
        >
          <EmojiConfetti fire={confettiFired} />
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[32px] border border-white/20 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_35%),linear-gradient(160deg,_#111827_0%,_#160f2d_55%,_#10203c_100%)] p-5 pt-16 text-white shadow-[0_30px_80px_rgba(17,24,39,0.55)]"
            style={{
              maxHeight:
                "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 32px)",
            }}
          >
            <div className="absolute left-4 right-4 top-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={onBack}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              >
                뒤로가기
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              >
                닫기
              </button>
            </div>

            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
                  YOMECHU REVEAL
                </p>
                {result ? (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/75">
                    추천 {result.result_count || winners.length}곳
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 break-keep text-2xl font-black tracking-[-0.05em] text-white">
                오늘 갈 곳을 정리해 드릴게요
              </h3>
              <p className="mt-1 break-keep text-sm leading-6 text-white/68">
                {getPhaseCopy(phase, isLoading)}
              </p>
            </div>

            {error ? (
              <div className="rounded-3xl border border-red-300/40 bg-red-400/10 px-4 py-5 text-sm leading-6 text-red-100">
                {error}
              </div>
            ) : isLoading ? (
              <div className="rounded-[28px] border border-white/10 bg-white/6 p-6">
                <div className="animate-reel-glow mb-4 h-40 rounded-[24px] bg-gradient-to-br from-primary/35 via-fuchsia-500/25 to-secondary/35" />
                <div className="h-3 w-28 rounded-full bg-white/10" />
                <div className="mt-3 h-6 w-44 rounded-full bg-white/10" />
                <div className="mt-2 h-4 w-56 rounded-full bg-white/10" />
              </div>
            ) : activePlace ? (
              <>
                <div className="rounded-[28px] border border-white/10 bg-white/7 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
                      {phase === "winner" ? "Winner" : "Shuffle"}
                    </span>
                    {result?.used_fallback ? (
                      <span className="rounded-full bg-amber-300/18 px-2.5 py-1 text-[10px] font-semibold text-amber-100">
                        업종 후보가 적어서 전체 후보까지 확장했습니다
                      </span>
                    ) : null}
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${activePlace.place_id}-${currentIndex}-${phase}`}
                      initial={{ opacity: 0, y: 24, rotateX: -12 }}
                      animate={{ opacity: 1, y: 0, rotateX: 0 }}
                      exit={{ opacity: 0, y: -18, rotateX: 10 }}
                      transition={{ duration: phase === "winner" ? 0.34 : 0.16 }}
                      className={`rounded-[24px] border p-5 ${
                        phase === "winner"
                          ? "border-primary/45 bg-white/12 shadow-[0_16px_40px_rgba(155,125,212,0.26)]"
                          : "border-white/10 bg-black/15"
                      }`}
                    >
                      <div className="inline-flex">
                        <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/18 px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-white shadow-[0_10px_22px_rgba(155,125,212,0.24)] backdrop-blur-sm">
                          {activePlace.category_label}
                        </span>
                      </div>
                      <h4 className="mt-2 break-keep text-[28px] font-black tracking-[-0.05em] text-white sm:text-[30px]">
                        {activePlace.name}
                      </h4>
                      <p className="mt-2 break-keep text-sm leading-6 text-white/70">
                        {activePlace.address}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                          {formatDistanceMeters(activePlace.distance_m)}
                        </span>
                        {activePlace.rating ? (
                          <span className="rounded-full bg-amber-300/18 px-3 py-1 text-xs font-semibold text-amber-100">
                            평점 {activePlace.rating.toFixed(1)}
                          </span>
                        ) : null}
                        {activePlace.trend_names.slice(0, 2).map((trend) => (
                          <span
                            key={trend}
                            className="rounded-full bg-primary/18 px-3 py-1 text-xs font-semibold text-white"
                          >
                            {trend}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
                  <span>후보 {result?.pool_size ?? 0}곳</span>
                  <span>{phase === "winner" ? "추천 정리 완료" : "후보를 섞는 중"}</span>
                </div>

                {phase === "winner" && winners.length > 1 ? (
                  <div className="mt-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
                      추천 리스트 · {winners.length}곳
                    </p>
                    <div className="flex flex-col gap-2">
                      {winners.map((place, index) => (
                        <ResultRow
                          key={`${place.place_id}-${index}`}
                          place={place}
                          index={index}
                          onOpenPlace={onOpenPlace}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {phase === "winner" && primaryWinner ? (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-5 flex flex-col gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenPlace(primaryWinner)}
                      className="w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)]"
                    >
                      {winners.length > 1 ? "1순위 지도에서 보기" : "지도에서 보기"}
                    </button>
                    {result?.spin_id && shareUrl ? (
                      <div className="flex justify-center">
                        <ShareButton
                          title={
                            winners.length > 1
                              ? `${primaryWinner.name} 포함 ${winners.length}곳 추천 - 요즘뭐먹`
                              : `${primaryWinner.name} 추천 - 요즘뭐먹`
                          }
                          description={`요메추가 고른 오늘의 추천 결과예요. ${primaryWinner.name}부터 확인해보세요.`}
                          url={shareUrl}
                          onShare={onShare}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={onReroll}
                      className="w-full rounded-2xl border border-white/14 bg-white/8 px-4 py-3 text-sm font-semibold text-white/82 transition-colors hover:bg-white/12"
                    >
                      다시 추천받기
                    </button>
                  </motion.div>
                ) : null}
              </>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
