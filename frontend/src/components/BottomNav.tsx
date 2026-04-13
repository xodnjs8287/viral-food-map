"use client";

import Link from "next/link";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
      {!active && <path d="M9 21V12h6v9" />}
    </svg>
  );
}

function SparkIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
      <path d="M5 14l.7 1.6L7.3 16l-1.6.7L5 18.3l-.7-1.6L2.7 16l1.6-.7L5 14z" />
    </svg>
  );
}

function MapIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 1 1 18 0z" />
      <circle cx="12" cy="10" r="3" fill={active ? "white" : "none"} />
    </svg>
  );
}

function ReportIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "홈", Icon: HomeIcon },
  { href: "/new", label: "신상", Icon: SparkIcon },
  { href: "/map", label: "지도", Icon: MapIcon },
  { href: "/report", label: "제보", Icon: ReportIcon },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    navItems.forEach((item) => {
      if (item.href !== pathname) {
        router.prefetch(item.href);
      }
    });
  }, [pathname, router]);

  const handleNav = (href: string) => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[60] isolate border-t border-gray-200 bg-white shadow-lg"
      style={{
        height: "calc(var(--bottom-nav-height) + var(--safe-bottom))",
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      <div className="mx-auto flex h-[var(--bottom-nav-height)] max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const shouldReplace = pathname !== "/" || item.href === "/";

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              replace={shouldReplace}
              aria-current={isActive ? "page" : undefined}
              onClick={(event) => {
                if (isActive) {
                  event.preventDefault();
                  return;
                }

                handleNav(item.href);
              }}
              className={`group flex flex-col items-center justify-center rounded-lg px-3 py-0.5 transition-colors ${
                isActive ? "text-primary" : "text-gray-400 hover:text-primary"
              }`}
            >
              <item.Icon active={isActive} />
              <span className="relative mt-0.5 text-xs font-medium after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all after:duration-200 group-hover:after:w-full">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
