"use client";

import { useEffect } from "react";
import { initPushNotifications } from "@/lib/push-notifications";

export default function NativeInitializer() {
  useEffect(() => {
    initPushNotifications().catch(() => {});
  }, []);
  return null;
}
