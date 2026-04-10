import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import NativeInitializer from "@/components/NativeInitializer";
import PageViewTracker from "@/components/PageViewTracker";
import { ADSENSE_CLIENT } from "@/lib/adsense";
import {
  NAVER_SITE_VERIFICATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import { absoluteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.json",
  icons: {
    icon: ["/icon-192.png", "/icon-512.png"],
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#9B7DD4",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl("/logo.png"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      inLanguage: "ko-KR",
      description: SITE_DESCRIPTION,
      alternateName: SITE_TITLE,
    },
  ];

  return (
    <html lang="ko">
      <head>
        <meta
          name="naver-site-verification"
          content={NAVER_SITE_VERIFICATION}
        />
        {structuredData.map((item) => (
          <script
            key={item["@type"]}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
          />
        ))}
      </head>
      <body className="min-h-screen bg-[#FAFAFA]">
        {ADSENSE_CLIENT && (
          <Script
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            strategy="afterInteractive"
            crossOrigin="anonymous"
          />
        )}
        <NativeInitializer />
        <PageViewTracker />
        {children}
      </body>
    </html>
  );
}
