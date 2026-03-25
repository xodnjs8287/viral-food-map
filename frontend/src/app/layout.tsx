import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "요즘뭐먹 - 지금 유행하는 음식, 어디서 살까?",
  description: "바이럴 음식 트렌드를 자동 탐지하고 내 주변 판매처를 찾아주는 서비스",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#9B7DD4",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <script
          type="text/javascript"
          src={`//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false&libraries=services,clusterer`}
        />
      </head>
      <body className="bg-gray-50 min-h-screen pb-16">{children}</body>
    </html>
  );
}
