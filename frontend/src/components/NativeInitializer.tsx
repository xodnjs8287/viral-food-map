"use client";

import { useEffect } from "react";
import { getPlatform, isNative } from "@/lib/capacitor-utils";

// TODO: Firebase ?ㅼ젙(google-services.json) ?꾨즺 ???꾨옒 二쇱꽍 ?댁젣
// import { initPushNotifications } from "@/lib/push-notifications";

export default function NativeInitializer() {
  useEffect(() => {
    if (isNative()) {
      const platform = getPlatform();
      const { body, documentElement } = document;

      documentElement.classList.add("native-app");
      documentElement.dataset.platform = platform;
      body.classList.add("native-app");
      body.dataset.platform = platform;

      return () => {
        documentElement.classList.remove("native-app");
        delete documentElement.dataset.platform;
        body.classList.remove("native-app");
        delete body.dataset.platform;
      };
    }

    // Firebase 誘몄꽕????PushNotifications.register()媛
    // ?ㅼ씠?곕툕 ?덈꺼?먯꽌 ?щ옒?쒕? ?쇱쑝?ㅻ?濡? ?ㅼ젙 ?꾧퉴吏 鍮꾪솢?깊솕.
    // initPushNotifications().catch(() => {});
  }, []);

  return null;
}
