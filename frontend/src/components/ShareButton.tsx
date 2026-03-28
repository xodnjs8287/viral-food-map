"use client";

import { useState } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { isNative } from "@/lib/capacitor-utils";

interface ShareButtonProps {
  title: string;
  description?: string;
  imageUrl?: string;
  url?: string;
  shareLabel?: string;
  copyLabel?: string;
  onShare?: (method: "native" | "kakao" | "copy") => void;
}

export default function ShareButton({
  title,
  description,
  imageUrl,
  url,
  shareLabel = "공유하기",
  copyLabel = "링크 복사",
  onShare,
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl = url ?? (typeof window !== "undefined" ? window.location.href : "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement("input");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    onShare?.("copy");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    const shareData = {
      title,
      url: shareUrl,
    };

    // 네이티브 앱: Capacitor Share → OS 공유 시트
    if (isNative()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title,
          text: description ?? "요즘뭐먹에서 확인해보세요!",
          url: shareUrl,
          dialogTitle: "공유하기",
        });
        onShare?.("native");
        return;
      } catch {
        // 사용자 취소 또는 에러 → 클립보드 폴백
        handleCopy();
        return;
      }
    }

    // 1순위: Web Share API (모바일 네이티브 시트 → 카카오톡 포함)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        onShare?.("native");
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }

    // 2순위: Kakao SDK
    if (typeof window !== "undefined" && (window as any).Kakao?.Share) {
      const K = (window as any).Kakao;
      if (!K.isInitialized()) K.init(process.env.NEXT_PUBLIC_KAKAO_MAP_KEY!);
      K.Share.sendDefault({
        objectType: "feed",
        content: {
          title,
          description: description ?? "요즘뭐먹에서 확인해보세요!",
          imageUrl: imageUrl ?? "https://www.yozmeat.com/icon-512.png",
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        },
        buttons: [
          {
            title: "판매처 보기",
            link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
          },
        ],
      });
      onShare?.("kakao");
      return;
    }

    // 3순위: 링크 복사
    handleCopy();
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleShare}
        className="flex items-center gap-1.5 bg-[#FEE500] text-[#3C1E1E] text-xs font-bold px-3 py-1.5 rounded-full hover:brightness-95 transition-all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3C6.477 3 2 6.582 2 11c0 2.796 1.57 5.264 3.978 6.837L5 21l3.745-1.97A11.4 11.4 0 0 0 12 19c5.523 0 10-3.582 10-8s-4.477-8-10-8z"/>
        </svg>
        {shareLabel}
      </button>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 bg-gray-100 text-gray-600 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-gray-200 transition-all"
      >
        {copied ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            복사됨
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            {copyLabel}
          </>
        )}
      </button>
    </div>
  );
}
