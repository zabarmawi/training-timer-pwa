import { validateAndBuildDataset } from "./core/validation/data-validation.js";
import { createTimerEngine } from "./core/timer/timer-engine.js";
import { createFacilitatorController } from "./ui/facilitator/facilitator-controller.js";
import { mountFacilitatorApp } from "./ui/facilitator/facilitator-view.js";
import { createAudienceState } from "./core/audience/audience-state.js";
import { createFacilitatorAudienceSync } from "./core/audience/audience-sync.js";
import { createStorageAdapter, createPersistenceManager } from "./core/storage/storage.js";
import { buildPersistentState, recoverApplicationState } from "./core/storage/recovery.js";
import { createWakeLockManager } from "./core/platform/wake-lock.js";
import { createPwaManager } from "./core/platform/pwa.js";
import { createAlertManager } from "./core/alerts/alert-manager.js";
import { createAlertPresenter } from "./core/platform/alert-presenter.js";
import { createWebPrintAdapter, createDesktopPrintAdapter } from "./core/platform/print.js";
import { createTauriAudience, createTauriOverlay, createTauriStorage, isTauriRuntime } from "./core/desktop/tauri-runtime.js";

const root = document.querySelector("#app");

try {
  const datasetUrl = new URL("../training_timer_canonical_dataset_V2.2.json", import.meta.url);
  const response = await fetch(datasetUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`تعذر تحميل البيانات (${response.status})`);
  const source = await response.json();
  const validation = validateAndBuildDataset(source);
  if (!validation.ok || !validation.model) {
    throw new Error("تعذر اعتماد بيانات التشغيل. راجع تقرير التحقق.");
  }
  const engine = createTimerEngine();
  const controller = createFacilitatorController(validation.model, engine);
  const development = ["localhost", "127.0.0.1"].includes(location.hostname);
  const desktop = isTauriRuntime(window);
  const tauri = desktop ? window.__TAURI__ : null;
  const storage = desktop ? await createTauriStorage(tauri) : createStorageAdapter({ development });
  const recovery = recoverApplicationState({
    state: storage.load().state,
    model: validation.model,
    engine,
    controller,
    now: Date.now(),
    development,
  });
  const alertManager = createAlertManager();
  alertManager.prime(controller.getViewModel().now?.snapshot ?? null);
  const alertPresenter = createAlertPresenter();
  const persistence = createPersistenceManager({
    adapter: storage,
    getState: () => buildPersistentState({
      controller,
      engine,
      datasetSchemaVersion: validation.model.schemaVersion,
      savedAt: Date.now(),
    }),
  });
  if (recovery.recoveredCompletion) persistence.flush();
  const audienceSync = createFacilitatorAudienceSync({
    getState: () => createAudienceState(controller.getViewModel(), Date.now()),
  });
  const desktopOverlay = desktop ? await createTauriOverlay({
    tauri,
    getState: () => createAudienceState(controller.getViewModel(), Date.now()),
  }) : null;
  const audienceAdapter = desktop ? createTauriAudience(tauri) : null;
  const printAdapter = desktop ? createDesktopPrintAdapter(tauri.core) : createWebPrintAdapter(window);
  const wakeLock = createWakeLockManager();
  let ui = null;
  const pwa = createPwaManager({
    onUpdate: () => ui?.notify("يتوفر تحديث جديد — سيطبق عند إعادة فتح التطبيق"),
    onInstallAvailable: () => ui?.rerender(),
  });
  ui = mountFacilitatorApp(root, controller, {
    audienceSync,
    persistence,
    wakeLock,
    pwa,
    desktopOverlay,
    openAudience: audienceAdapter ? () => audienceAdapter.open() : null,
    printAdapter,
    alerts: { manager: alertManager, presenter: alertPresenter },
    recoveryNotice: recovery.recoveredCompletion ? "انتهى المؤقت أثناء غياب التطبيق" : null,
  });
  audienceSync.publish();
  desktopOverlay?.publish();
  wakeLock.sync(controller.getViewModel().now?.snapshot.status ?? "idle");
  pwa.register();

  const flushPersistence = () => persistence.flush();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersistence();
  });
  window.addEventListener("pagehide", flushPersistence);
  window.addEventListener("beforeunload", flushPersistence);
} catch (error) {
  root.innerHTML = `
    <main class="fatal-error" role="alert">
      <p class="eyebrow">تعذر بدء التطبيق</p>
      <h1>بيانات التشغيل غير متاحة</h1>
      <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
    </main>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
