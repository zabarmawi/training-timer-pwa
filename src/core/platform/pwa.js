// @ts-check

export function createPwaManager({ windowRef = window, navigatorRef = navigator, onUpdate = () => {}, onInstallAvailable = () => {} } = {}) {
  let installPrompt = null;
  let registration = null;

  windowRef.addEventListener?.("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    onInstallAvailable();
  });

  async function register() {
    // The packaged Tauri assets must never use the web app's navigation fallback.
    if (windowRef.__TAURI_INTERNALS__) return { ok: false, code: "SERVICE_WORKER_UNAVAILABLE" };
    if (!("serviceWorker" in navigatorRef) || !/^https?:$/.test(windowRef.location?.protocol ?? "")) {
      return { ok: false, code: "SERVICE_WORKER_UNAVAILABLE" };
    }
    try {
      const workerUrl = new URL("../../../service-worker.js", import.meta.url);
      registration = await navigatorRef.serviceWorker.register(workerUrl.href);
      registration.addEventListener?.("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener?.("statechange", () => {
          if (worker.state === "installed" && navigatorRef.serviceWorker.controller) onUpdate();
        });
      });
      return { ok: true, registration };
    } catch {
      return { ok: false, code: "SERVICE_WORKER_REGISTRATION_FAILED" };
    }
  }

  async function install() {
    if (!installPrompt) return { ok: false, code: "INSTALL_PROMPT_UNAVAILABLE" };
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;
    return { ok: choice?.outcome === "accepted", outcome: choice?.outcome ?? "dismissed" };
  }

  return Object.freeze({ register, install, canInstall: () => Boolean(installPrompt), getRegistration: () => registration });
}
