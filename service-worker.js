const CACHE_VERSION = "training-timer-v4";
const APP_BASE = new URL("./", self.location.href);
const CRITICAL_ASSETS = [
  "./",
  "./index.html",
  "./audience.html",
  "./manifest.webmanifest",
  "./training_timer_canonical_dataset_V2.2.json",
  "./src/main.js",
  "./src/styles.css",
  "./src/core/validation/data-validation.js",
  "./src/core/timer/timer-engine.js",
  "./src/core/audience/audience-state.js",
  "./src/core/audience/audience-sync.js",
  "./src/core/storage/schema.js",
  "./src/core/storage/migration.js",
  "./src/core/storage/storage.js",
  "./src/core/storage/recovery.js",
  "./src/core/platform/wake-lock.js",
  "./src/core/platform/pwa.js",
  "./src/core/platform/alert-presenter.js",
  "./src/core/platform/audience-window.js",
  "./src/core/platform/print.js",
  "./src/core/alerts/alert-manager.js",
  "./src/core/desktop/overlay-state.js",
  "./src/core/desktop/overlay-settings.js",
  "./src/core/desktop/desktop-overlay.js",
  "./src/core/desktop/tauri-runtime.js",
  "./src/core/desktop/tauri-store.js",
  "./src/core/storage/desktop-storage.js",
  "./src/ui/facilitator/facilitator-controller.js",
  "./src/ui/facilitator/facilitator-view.js",
  "./src/ui/audience/audience-main.js",
  "./src/ui/audience/audience-view.js",
  "./src/ui/audience/audience.css",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./assets/identity/institutional-logos.png",
  "./assets/audio/alert-5m.wav",
  "./assets/audio/alert-1m.wav",
  "./assets/audio/alert-finish.wav"
].map((path) => new URL(path, APP_BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(CRITICAL_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("training-timer-") && key !== CACHE_VERSION).map((key) => caches.delete(key))
  )));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((cached) => {
    if (cached) return cached;
    if (event.request.mode === "navigate") {
      const fallback = new URL(
        new URL(event.request.url).pathname.endsWith("audience.html") ? "./audience.html" : "./index.html",
        self.registration.scope
      ).href;
      return caches.match(fallback);
    }
    return fetch(event.request);
  }));
});
