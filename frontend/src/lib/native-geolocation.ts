import { isNative } from "./capacitor-utils";

interface Position {
  lat: number;
  lng: number;
}

// --- 모듈 레벨 캐시 ---
let cachedPosition: Position | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30초: fresh
const STALE_TTL_MS = 120_000; // 2분: 사용 가능하지만 stale

// 동시 요청 중복 방지
let inflightRequest: Promise<Position> | null = null;

function updateCache(pos: Position) {
  cachedPosition = pos;
  cacheTimestamp = Date.now();
}

export function invalidateLocationCache() {
  cachedPosition = null;
  cacheTimestamp = 0;
}

/**
 * 네이티브에서는 Capacitor Geolocation, 웹에서는 navigator.geolocation 사용.
 * - 30초 내 캐시 반환 (GPS 재요청 없음)
 * - 기본 enableHighAccuracy: false (셀/WiFi 우선, 0.2~1.5초)
 * - enableHighAccuracy: true 시 저정밀 즉시 반환 → 고정밀 백그라운드 업그레이드
 */
export async function getCurrentPosition(
  options?: { timeout?: number; enableHighAccuracy?: boolean; maxCacheAge?: number }
): Promise<Position> {
  const maxCacheAge = options?.maxCacheAge ?? CACHE_TTL_MS;

  // 1. 캐시 히트 시 즉시 반환
  if (cachedPosition && (Date.now() - cacheTimestamp) <= maxCacheAge) {
    return cachedPosition;
  }

  // 2. 이미 진행 중인 요청이 있으면 대기
  if (inflightRequest) {
    return inflightRequest;
  }

  // 3. 새 요청 실행
  inflightRequest = doGetPosition(options).finally(() => {
    inflightRequest = null;
  });

  return inflightRequest;
}

async function doGetPosition(
  options?: { timeout?: number; enableHighAccuracy?: boolean }
): Promise<Position> {
  const timeout = options?.timeout ?? 5000;
  const wantHighAccuracy = options?.enableHighAccuracy ?? false;

  if (isNative()) {
    return doGetPositionNative(timeout, wantHighAccuracy);
  }
  return doGetPositionWeb(timeout, wantHighAccuracy);
}

async function doGetPositionNative(
  timeout: number,
  wantHighAccuracy: boolean
): Promise<Position> {
  const { Geolocation } = await import("@capacitor/geolocation");

  // 권한 확인 → 필요 시 요청
  let perm = await Geolocation.checkPermissions();
  if (perm.location === "prompt" || perm.location === "prompt-with-rationale") {
    perm = await Geolocation.requestPermissions();
  }
  if (perm.location === "denied") {
    throw new Error("PERMISSION_DENIED");
  }

  // Phase 1: 저정밀 빠른 위치 (셀/WiFi)
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: Math.min(timeout, 3000),
  });
  const result: Position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  updateCache(result);

  // Phase 2: 백그라운드에서 고정밀(GPS) 위치 업그레이드
  Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout,
  })
    .then((hiPos) => {
      updateCache({ lat: hiPos.coords.latitude, lng: hiPos.coords.longitude });
    })
    .catch(() => {});

  return result;
}

function doGetPositionWeb(
  timeout: number,
  wantHighAccuracy: boolean
): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GEOLOCATION_NOT_SUPPORTED"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const result = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        updateCache(result);
        resolve(result);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("PERMISSION_DENIED"));
        else if (err.code === err.TIMEOUT) reject(new Error("TIMEOUT"));
        else reject(new Error("POSITION_UNAVAILABLE"));
      },
      {
        enableHighAccuracy: wantHighAccuracy,
        timeout,
        maximumAge: 30000,
      }
    );
  });
}
