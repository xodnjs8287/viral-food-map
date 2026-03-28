import { isNative } from "./capacitor-utils";

interface Position {
  lat: number;
  lng: number;
}

/**
 * 네이티브에서는 Capacitor Geolocation, 웹에서는 navigator.geolocation 사용.
 * 네이티브: 런타임 권한 다이얼로그 자동 표시.
 */
export async function getCurrentPosition(
  options?: { timeout?: number; enableHighAccuracy?: boolean }
): Promise<Position> {
  const timeout = options?.timeout ?? 8000;
  const enableHighAccuracy = options?.enableHighAccuracy ?? true;

  if (isNative()) {
    const { Geolocation } = await import("@capacitor/geolocation");

    // 권한 확인 → 필요 시 요청
    let perm = await Geolocation.checkPermissions();
    if (perm.location === "prompt" || perm.location === "prompt-with-rationale") {
      perm = await Geolocation.requestPermissions();
    }
    if (perm.location === "denied") {
      throw new Error("PERMISSION_DENIED");
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy,
      timeout,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }

  // 웹 폴백
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GEOLOCATION_NOT_SUPPORTED"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("PERMISSION_DENIED"));
        else if (err.code === err.TIMEOUT) reject(new Error("TIMEOUT"));
        else reject(new Error("POSITION_UNAVAILABLE"));
      },
      { enableHighAccuracy, timeout, maximumAge: 0 }
    );
  });
}
