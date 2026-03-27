"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export default function PushSubscribeButton() {
  const [status, setStatus] = useState<"idle" | "subscribed" | "denied" | "unsupported">("idle");

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "granted") {
      setStatus("subscribed");
    } else if (Notification.permission === "denied") {
      setStatus("denied");
    }
  }, []);

  const handleSubscribe = async () => {
    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator)) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const { endpoint, keys } = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };

      await supabase.from("push_subscriptions").upsert(
        { endpoint, p256dh: keys.p256dh, auth: keys.auth },
        { onConflict: "endpoint" }
      );

      setStatus("subscribed");
    } catch {
      setStatus("idle");
    }
  };

  if (status === "denied") return null;

  if (status === "unsupported") {
    const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!isIOS) return null;
    return (
      <p className="text-xs text-gray-400 text-center">
        iOS에서는 홈 화면에 추가하면 알림을 받을 수 있어요
      </p>
    );
  }

  if (status === "subscribed") {
    return (
      <span className="text-xs text-gray-400 flex items-center gap-1">
        🔔 새 트렌드 알림 수신 중
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={handleSubscribe}
        className="text-xs text-primary flex items-center gap-1 border border-primary/30 rounded-full px-3 py-1"
      >
        🔔 새 트렌드 알림 받기
      </button>
      <p className="text-[10px] text-gray-400">브라우저 푸시 알림으로 새 트렌드 소식을 알려드려요</p>
    </div>
  );
}
