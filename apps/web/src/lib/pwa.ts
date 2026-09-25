/**
 * Service worker registration (production builds only). New versions wait
 * until the user reloads, so a booking screen is never swapped mid-session.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export const install = {
  available: () => deferred !== null,
  isStandalone: () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true),
  isIos: () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async prompt() {
    if (!deferred) return;
    await deferred.prompt();
    deferred = null;
    listeners.forEach((l) => l());
  },
};
