"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

interface HeaderProps {
  showBack?: boolean;
}

export default function Header({ showBack }: HeaderProps) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm relative">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-center">
        {showBack && (
          <button
            onClick={() => router.back()}
            className="absolute left-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            뒤로
          </button>
        )}
        <Link href="/">
          <img src="/logo-title.png" alt="요즘뭐먹" className="h-9 object-contain" />
        </Link>
      </div>
    </header>
  );
}
