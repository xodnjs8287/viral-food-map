"use client";

import { useEffect } from "react";

import { getPlatform, isNative } from "@/lib/capacitor-utils";

const APP_HOSTS = new Set(["www.yozmeat.com", "yozmeat.com"]);
const APP_SCHEMES = new Set(["com.yozmeat.app"]);

function resolveNativeAppUrl(rawUrl: string) {
  try {
    const parsedUrl = new URL(rawUrl);
    const scheme = parsedUrl.protocol.replace(":", "");

    if (parsedUrl.protocol === "https:" && APP_HOSTS.has(parsedUrl.hostname)) {
      return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}` || "/";
    }

    if (APP_SCHEMES.has(scheme)) {
      const nextPath =
        parsedUrl.pathname && parsedUrl.pathname !== "/"
          ? parsedUrl.pathname
          : parsedUrl.host
            ? `/${parsedUrl.host}`
            : "/";

      return `${nextPath}${parsedUrl.search}${parsedUrl.hash}` || "/";
    }
  } catch {
    return null;
  }

  return null;
}

function navigateToNativeAppUrl(rawUrl: string) {
  const nextUrl = resolveNativeAppUrl(rawUrl);

  if (!nextUrl) {
    return;
  }

  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (currentUrl === nextUrl) {
    return;
  }

  window.location.assign(nextUrl);
}

export default function NativeInitializer() {
  useEffect(() => {
    if (isNative()) {
      const platform = getPlatform();
      const { body, documentElement } = document;
      let removeAppListener: (() => void) | null = null;
      let isDisposed = false;

      documentElement.classList.add("native-app");
      documentElement.dataset.platform = platform;
      body.classList.add("native-app");
      body.dataset.platform = platform;

      void import("@capacitor/geolocation").then(({ Geolocation }) => {
        Geolocation.checkPermissions();
      });

      void import("@capacitor/app")
        .then(async ({ App }) => {
          const launchUrl = await App.getLaunchUrl();

          if (!isDisposed && launchUrl?.url) {
            navigateToNativeAppUrl(launchUrl.url);
          }

          const listener = await App.addListener("appUrlOpen", ({ url }) => {
            navigateToNativeAppUrl(url);
          });

          if (isDisposed) {
            listener.remove();
            return;
          }

          removeAppListener = () => {
            void listener.remove();
          };
        })
        .catch(() => {
          removeAppListener = null;
        });

      return () => {
        isDisposed = true;
        removeAppListener?.();
        documentElement.classList.remove("native-app");
        delete documentElement.dataset.platform;
        body.classList.remove("native-app");
        delete body.dataset.platform;
      };
    }
  }, []);

  return null;
}
