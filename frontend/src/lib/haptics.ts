import {
  Haptics,
  ImpactStyle,
  NotificationType,
} from "@capacitor/haptics";

import { isNative } from "@/lib/capacitor-utils";

type HapticCleanup = () => void;

function canUseVibrateApi() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function playFireworkHaptics(): HapticCleanup {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (isNative()) {
    const timeouts: number[] = [];
    const steps: Array<{ delayMs: number; run: () => Promise<void> }> = [
      { delayMs: 0, run: () => Haptics.impact({ style: ImpactStyle.Light }) },
      { delayMs: 90, run: () => Haptics.impact({ style: ImpactStyle.Medium }) },
      { delayMs: 180, run: () => Haptics.impact({ style: ImpactStyle.Heavy }) },
      {
        delayMs: 310,
        run: () => Haptics.notification({ type: NotificationType.Success }),
      },
    ];

    steps.forEach(({ delayMs, run }) => {
      const timeout = window.setTimeout(() => {
        void run().catch(() => {});
      }, delayMs);
      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }

  if (canUseVibrateApi()) {
    navigator.vibrate([20, 50, 32, 72, 78]);

    return () => {
      navigator.vibrate(0);
    };
  }

  return () => {};
}
