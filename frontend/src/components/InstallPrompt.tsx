"use client";

import { useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CloseButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors -mr-1"
    aria-label="닫기"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  </button>
);

const IconBox = ({ children }: { children: React.ReactNode }) => (
  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center flex-shrink-0">
    {children}
  </div>
);

export default function InstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [showChrome, setShowChrome] = useState(false);
  const [showIos, setShowIos] = useState(false);
  const [showKakaoAndroid, setShowKakaoAndroid] = useState(false);
  const [showKakaoIos, setShowKakaoIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const ua = navigator.userAgent;
    const isKakao = /KAKAOTALK/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const isIos = /iPhone|iPad|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);

    if (isKakao && isAndroid) {
      setShowKakaoAndroid(true);
      return;
    }

    if (isKakao && isIos) {
      setShowKakaoIos(true);
      return;
    }

    if (isIos && isSafari) {
      setShowIos(true);
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setShowChrome(true);
    };

    const handleInstalled = () => {
      setShowChrome(false);
      deferredPrompt.current = null;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === "accepted") setShowChrome(false);
    deferredPrompt.current = null;
  };

  const handleOpenInChrome = () => {
    const url = location.href;
    location.href = `intent://${url.replace(/https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
  };

  if (dismissed) return null;

  // 카카오톡 Android → Chrome으로 열기
  if (showKakaoAndroid) {
    return (
      <div className="mb-4 bg-white rounded-2xl border border-purple-100 p-4 flex items-center gap-3 shadow-sm">
        <IconBox>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </IconBox>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">앱으로 설치하기</p>
          <p className="text-xs text-gray-400">Chrome에서 열면 홈 화면에 추가할 수 있어요</p>
        </div>
        <button
          onClick={handleOpenInChrome}
          className="flex-shrink-0 bg-primary text-white text-xs font-semibold px-3.5 py-2 rounded-xl hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          Chrome으로 열기
        </button>
        <CloseButton onClick={() => setDismissed(true)} />
      </div>
    );
  }

  // 카카오톡 iOS → 수동 안내
  if (showKakaoIos) {
    return (
      <div className="mb-4 bg-white rounded-2xl border border-purple-100 p-4 flex items-start gap-3 shadow-sm">
        <IconBox>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </IconBox>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">앱으로 설치하기</p>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
            우측 하단 <strong className="text-gray-600">···</strong> 메뉴 →{" "}
            <strong className="text-gray-600">Safari로 열기</strong> 후 설치하세요
          </p>
        </div>
        <CloseButton onClick={() => setDismissed(true)} />
      </div>
    );
  }

  // iOS Safari 안내
  if (showIos) {
    return (
      <div className="mb-4 bg-white rounded-2xl border border-purple-100 p-4 flex items-start gap-3 shadow-sm">
        <IconBox>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </IconBox>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">홈 화면에 추가하기</p>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
            하단의{" "}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-text-bottom text-primary">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>{" "}
            공유 버튼을 누른 후<br />
            <strong className="text-gray-600">홈 화면에 추가</strong>를 선택하세요
          </p>
        </div>
        <CloseButton onClick={() => setDismissed(true)} />
      </div>
    );
  }

  // Chrome 계열 설치 배너
  if (!showChrome) return null;

  return (
    <div className="mb-4 bg-white rounded-2xl border border-purple-100 p-4 flex items-center gap-3 shadow-sm">
      <IconBox>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </IconBox>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">홈 화면에 추가하기</p>
        <p className="text-xs text-gray-400">앱처럼 빠르게 열 수 있어요</p>
      </div>
      <button
        onClick={handleInstallClick}
        className="flex-shrink-0 bg-primary text-white text-xs font-semibold px-3.5 py-2 rounded-xl hover:opacity-90 transition-opacity"
      >
        설치
      </button>
      <CloseButton onClick={() => setDismissed(true)} />
    </div>
  );
}
