import { isNative, getPlatform } from "./capacitor-utils";
import { supabase } from "./supabase";

/**
 * 네이티브 푸시 알림 초기화.
 * Firebase 설정(google-services.json / APNs)이 완료되어야 실제 동작.
 */
export async function initPushNotifications(): Promise<void> {
  if (!isNative()) return;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  const permResult = await PushNotifications.checkPermissions();
  if (permResult.receive === "prompt") {
    const reqResult = await PushNotifications.requestPermissions();
    if (reqResult.receive !== "granted") return;
  } else if (permResult.receive !== "granted") {
    return;
  }

  await PushNotifications.register();

  PushNotifications.addListener("registration", async (token) => {
    await supabase.from("push_tokens").upsert(
      {
        token: token.value,
        platform: getPlatform(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" }
    );
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.warn("Push registration error:", err);
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    // 포그라운드에서 알림 수신 시 — 필요하면 인앱 토스트 표시
    console.log("Push received:", notification);
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action.notification.data;
    if (data?.trend_id) {
      window.location.href = `/trend/${data.trend_id}`;
    } else if (data?.url) {
      window.location.href = data.url;
    }
  });
}

