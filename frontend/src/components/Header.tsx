"use client";

import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="요즘뭐먹" className="w-8 h-8 rounded-full" />
          <h1 className="text-xl font-display text-primary tracking-tight">요즘뭐먹</h1>
        </Link>
        <p className="text-xs text-gray-400 font-medium">트렌드 음식 지도</p>
      </div>
    </header>
  );
}
