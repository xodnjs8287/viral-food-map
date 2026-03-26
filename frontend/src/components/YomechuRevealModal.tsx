"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { formatDistanceMeters } from "@/lib/crawler";
import type { YomechuPlace, YomechuSpinResponse } from "@/lib/types";

interface YomechuRevealModalProps {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  result: YomechuSpinResponse | null;
  onClose: () => void;
  onReroll: () => void;
  onOpenPlace: (place: YomechuPlace) => void;
}

type RevealPhase = "idle" | "fast" | "slow" | "winner";

function getPhaseCopy(phase: RevealPhase, isLoading: boolean) {
  if (isLoading) {
    return "근처 후보를 뒤섞는 중";
  }

  switch (phase) {
    case "fast":
      return "후보를 빠르게 훑는 중";
    case "slow":
      return "마지막 한 곳을 좁히는 중";
    case "winner":
      return "오늘의 한 끼가 결정됐어요";
    default:
      return "후보를 준비하고 있어요";
  }
}

export default function YomechuRevealModal({
  isOpen,
  isLoading,
  error,
  result,
  onClose,
  onReroll,
  onOpenPlace,
}: YomechuRevealModalProps) {
  const reel = useMemo(() => {
    if (!result) return [];
    return result.reel.length > 0 ? result.reel : [result.winner];
  }, [result]);

  const [phase, setPhase] = useState<RevealPhase>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!isOpen || !result || reel.length === 0) {
      setPhase("idle");
      setCurrentIndex(0);
      return;
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    let frame = 0;

    setPhase("fast");
    setCurrentIndex(0);

    for (let i = 0; i < 12; i += 1) {
      elapsed += 80;
      timeouts.push(
        setTimeout(() => {
          setPhase("fast");
          setCurrentIndex(frame % reel.length);
          frame += 1;
        }, elapsed)
      );
    }

    const slowIntervals = [160, 200, 240, 300, 360, 420];
    slowIntervals.forEach((delay) => {
      elapsed += delay;
      timeouts.push(
        setTimeout(() => {
          setPhase("slow");
          setCurrentIndex(frame % reel.length);
          frame += 1;
        }, elapsed)
      );
    });

    elapsed += 300;
    timeouts.push(
      setTimeout(() => {
        setPhase("winner");
        setCurrentIndex(Math.max(reel.length - 1, 0));
      }, elapsed)
    );

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [isOpen, reel, result]);

  const activePlace = reel[currentIndex] ?? result?.winner ?? null;
  const winner = result?.winner ?? null;

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-gray-950/55 px-4 py-4 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="relative w-full max-w-md overflow-hidden rounded-[32px] border border-white/20 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_35%),linear-gradient(160deg,_#111827_0%,_#160f2d_55%,_#10203c_100%)] p-5 text-white shadow-[0_30px_80px_rgba(17,24,39,0.55)]"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            >
              닫기
            </button>

            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
                YOMECHU REVEAL
              </p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                어디 갈지 딱 정해드릴게요
              </h3>
              <p className="mt-1 text-sm text-white/68">
                {getPhaseCopy(phase, isLoading)}
              </p>
            </div>

            {error ? (
              <div className="rounded-3xl border border-red-300/40 bg-red-400/10 px-4 py-5 text-sm text-red-100">
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
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
                      {phase === "winner" ? "Winner" : "Shuffle"}
                    </span>
                    {result?.used_fallback ? (
                      <span className="rounded-full bg-amber-300/18 px-2.5 py-1 text-[10px] font-semibold text-amber-100">
                        업종 결과가 적어 전체 후보로 확장됨
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
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
                        {activePlace.category_label}
                      </p>
                      <h4 className="mt-2 text-[30px] font-black tracking-[-0.05em] text-white">
                        {activePlace.name}
                      </h4>
                      <p className="mt-2 text-sm leading-6 text-white/70">
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

                <div className="mt-4 flex items-center justify-between text-xs text-white/55">
                  <span>후보 {result?.pool_size ?? 0}곳</span>
                  <span>{phase === "winner" ? "결정 완료" : "셔플 중"}</span>
                </div>

                {phase === "winner" && winner ? (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-5 flex flex-col gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenPlace(winner)}
                      className="w-full rounded-2xl bg-gradient-to-r from-primary via-fuchsia-500 to-secondary px-4 py-3 text-sm font-black tracking-[0.02em] text-white shadow-[0_16px_32px_rgba(155,125,212,0.28)]"
                    >
                      지도에서 보기
                    </button>
                    <button
                      type="button"
                      onClick={onReroll}
                      className="w-full rounded-2xl border border-white/14 bg-white/8 px-4 py-3 text-sm font-semibold text-white/82 transition-colors hover:bg-white/12"
                    >
                      다시 돌리기
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
