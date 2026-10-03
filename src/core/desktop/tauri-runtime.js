// @ts-check

import { createDesktopOverlayManager } from "./desktop-overlay.js";
import { createDesktopStorageAdapter } from "../storage/desktop-storage.js";
import { createDesktopAudienceAdapter } from "../platform/audience-window.js";
import { createTauriStoreApi } from "./tauri-store.js";

export function isTauriRuntime(windowRef = window) {
  return Boolean(windowRef.__TAURI_INTERNALS__ && windowRef.__TAURI__);
}

export async function createTauriStorage(tauri) {
  return createDesktopStorageAdapter(createTauriStoreApi(tauri?.core));
}

export async function createTauriOverlay({ tauri, getState }) {
  const OverlayWindow = tauri?.webviewWindow?.WebviewWindow;
  const overlayWindow = await OverlayWindow?.getByLabel?.("timer-overlay");
  if (!overlayWindow) throw new Error("TAURI_OVERLAY_WINDOW_UNAVAILABLE");
  const settings = await createTauriStoreApi(tauri?.core).load("training-timer-overlay.json", { autoSave: false });
  const manager = createDesktopOverlayManager({
    getState,
    transport: {
      emitTo: (label, event, payload) => tauri.event.emitTo(label, event, payload),
      listen: (event, handler) => tauri.event.listen(event, handler, { target: { kind: "WebviewWindow", label: "main" } }),
    },
    window: {
      show: () => overlayWindow.show(),
      hide: () => overlayWindow.hide(),
      isVisible: () => overlayWindow.isVisible(),
    },
    settings,
  });
  await manager.init();
  return manager;
}

export function createTauriAudience(tauri) {
  const AudienceWindow = tauri?.webviewWindow?.WebviewWindow;
  if (!AudienceWindow) throw new Error("TAURI_AUDIENCE_WINDOW_UNAVAILABLE");
  return createDesktopAudienceAdapter({
    getByLabel: (label) => AudienceWindow.getByLabel(label),
    create: (label, options) => new AudienceWindow(label, options),
  });
}
