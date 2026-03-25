"use client";

import { useState } from "react";

interface ShareButtonProps {
  title: string;
  description?: string;
  imageUrl?: string;
  url?: string;
}

export default function ShareButton({ title, description, imageUrl, url }: ShareButtonProps) {
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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const shareData = {
      title,
      url: shareUrl,
    };

    // 1순위: Web Share API (모바일 네이티브 시트 → 카카오톡 포함)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
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
        공유하기
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
            링크 복사
          </>
        )}
      </button>
    </div>
  );
}
