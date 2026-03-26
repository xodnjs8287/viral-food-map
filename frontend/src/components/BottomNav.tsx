"use client";

import { usePathname, useRouter } from "next/navigation";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
      {!active && <path d="M9 21V12h6v9" />}
    </svg>
  );
}

function MapIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 1 1 18 0z" />
      <circle cx="12" cy="10" r="3" fill={active ? "white" : "none"} />
    </svg>
  );
}

function ReportIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "홈", Icon: HomeIcon },
  { href: "/map", label: "지도", Icon: MapIcon },
  { href: "/report", label: "제보", Icon: ReportIcon },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleNav = (href: string) => {
    if (href === pathname) return;          // 같은 탭 → 무시
    if (href === "/") {
      router.replace("/");                  // 홈은 항상 replace (스택 쌓지 않음)
    } else {
      // 홈이 아닌 탭: 현재가 홈이면 push, 아니면 replace
      if (pathname === "/") {
        router.push(href);
      } else {
        router.replace(href);
      }
    }
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-lg mx-auto flex justify-around py-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <button
              key={item.href}
              onClick={() => handleNav(item.href)}
              className={`flex flex-col items-center px-4 py-1 rounded-lg transition-colors group ${
                isActive ? "text-primary" : "text-gray-400 hover:text-primary"
              }`}
            >
              <item.Icon active={isActive} />
              <span className="text-xs mt-0.5 font-medium relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-px after:bg-primary after:transition-all after:duration-200 group-hover:after:w-full">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
