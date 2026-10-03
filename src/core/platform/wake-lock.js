// @ts-check

/** @param {{navigatorRef?: Navigator, documentRef?: Document, secureContext?: boolean, windowRef?: any}} [options] */
export function createWakeLockManager(options = {}) {
  const navigatorRef = options.navigatorRef ?? navigator;
  const documentRef = options.documentRef ?? document;
  const secureContext = options.secureContext ?? (globalThis.isSecureContext !== false);
  const windowRef = options.windowRef ?? globalThis.window;
  const nativeInvoke = /Windows/i.test(navigatorRef.userAgent ?? "") && windowRef?.__TAURI_INTERNALS__
    ? windowRef?.__TAURI__?.core?.invoke : null;
  const supported = Boolean(nativeInvoke) || (secureContext && Boolean(navigatorRef.wakeLock?.request));
  const listeners = new Set();
  let sentinel = null;
  let desiredRunning = false;
  let requesting = false;
  let status = supported ? "inactive" : "unavailable";

  function setStatus(nextStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    for (const listener of listeners) listener(status);
  }

  async function request() {
    if (!desiredRunning || sentinel || requesting || (!nativeInvoke && documentRef.visibilityState === "hidden")) return false;
    if (!supported) { setStatus("unavailable"); return false; }
    requesting = true;
    setStatus("requesting");
    try {
      const acquired = nativeInvoke
        ? await nativeInvoke("set_screen_awake", { active: true }).then(() => ({ release: () => nativeInvoke("set_screen_awake", { active: false }) }))
        : await navigatorRef.wakeLock.request("screen");
      // Pause/completion can arrive while the platform request is pending.
      if (!desiredRunning) {
        await acquired?.release?.();
        setStatus(supported ? "inactive" : "unavailable");
        return false;
      }
      sentinel = acquired;
      acquired?.addEventListener?.("release", () => {
        if (sentinel !== acquired) return;
        sentinel = null;
        setStatus(desiredRunning ? "interrupted" : "inactive");
      });
      setStatus("active");
      return true;
    } catch {
      sentinel = null;
      setStatus("unavailable");
      return false;
    } finally {
      requesting = false;
    }
  }

  async function release() {
    const current = sentinel;
    sentinel = null;
    try { await current?.release?.(); } catch { /* Wake Lock is best effort. */ }
    setStatus(supported ? "inactive" : "unavailable");
  }

  async function sync(status) {
    desiredRunning = status === "running";
    if (desiredRunning) return request();
    await release();
    return false;
  }

  function onVisibilityChange() {
    if (documentRef.visibilityState === "visible" && desiredRunning) void request();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  documentRef.addEventListener?.("visibilitychange", onVisibilityChange);
  return Object.freeze({ sync, release, onVisibilityChange, subscribe, getStatus: () => status, isHeld: () => Boolean(sentinel) });
}
