"use client";

import { useEffect, useRef } from "react";
import { ADSENSE_CLIENT } from "@/lib/adsense";
import { isNative } from "@/lib/capacitor-utils";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

interface AdSlotProps {
  slot: string;
  className?: string;
  minHeightClassName?: string;
}

export default function AdSlot({
  slot,
  className = "",
  minHeightClassName = "min-h-[180px]",
}: AdSlotProps) {
  const adRef = useRef<HTMLModElement | null>(null);
  const requestedRef = useRef(false);
  const nativeApp = typeof window !== "undefined" ? isNative() : false;

  useEffect(() => {
    if (!slot || nativeApp || requestedRef.current || !adRef.current) {
      return;
    }

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      requestedRef.current = true;
    } catch (error) {
      console.error("AdSense slot failed to initialize", error);
    }
  }, [nativeApp, slot]);

  if (!slot || !ADSENSE_CLIENT || nativeApp) {
    return null;
  }

  return (
    <section className={className} aria-label="광고">
      <p className="mb-2 text-[11px] font-medium tracking-[0.12em] text-gray-400">
        광고
      </p>
      <div
        className={`overflow-hidden rounded-2xl border border-gray-100 bg-white px-3 py-3 ${minHeightClassName}`}
      >
        <ins
          ref={adRef}
          className="adsbygoogle block h-full w-full"
          style={{ display: "block" }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </section>
  );
}
