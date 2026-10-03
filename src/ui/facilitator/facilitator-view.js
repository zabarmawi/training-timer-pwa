// @ts-check

import { formatTime } from "./facilitator-controller.js";

const DEFAULT_TITLE = "مؤقت البرنامج المهني لسفراء القيادة";
const RELEASE_CREDIT = "إعداد: فهد زبرماوي";
const RELEASE_VERSION = "V 1.0.0";

/** @param {HTMLElement} root @param {ReturnType<import('./facilitator-controller.js').createFacilitatorController>} controller @param {{audienceSync?: ReturnType<import('../../core/audience/audience-sync.js').createFacilitatorAudienceSync>, persistence?: {schedule():void, flush():unknown}, wakeLock?: {sync(status:string):unknown, getStatus?():string, subscribe?(listener:(status:string)=>void):()=>void}, pwa?: {canInstall():boolean, install():Promise<unknown>}, desktopOverlay?: {publish():Promise<unknown>,toggle():Promise<unknown>,isVisible():boolean}, openAudience?: (()=>Promise<{ok:boolean,code?:string}>) | null, printAdapter?: {print():Promise<{ok:boolean,code?:string}>}, alerts?: {manager:{observe(snapshot:any):any[]},presenter:{present(event:any,options:{soundEnabled:boolean,notify:(message:string)=>void}):unknown}}, recoveryNotice?: string | null}} [options] */
export function mountFacilitatorApp(root, controller, options = {}) {
  const audienceSync = options.audienceSync;
  const persistence = options.persistence;
  const wakeLock = options.wakeLock;
  let undo = null;
  let pendingToast = null;
  let toastTimer = null;
  let lastFrame = 0;
  let lastStatus = null;
  let lastConnectionStatus = audienceSync?.getConnection().status ?? "not-opened";
  let settingsOpen = false;

  const persistenceActions = new Set([
    "home", "select-track", "select-program", "select-package", "select-day", "go-now",
    "activate-item", "toggle-current", "add-minute", "subtract-minute", "confirm-reset",
    "confirm-conflict", "previous", "next", "open-next", "enter-focus", "exit-focus",
    "toggle-sound", "confirm-scope-reset", "undo",
  ]);

  root.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");

    if (action === "home") controller.goHome();
    if (action === "select-track" && id) controller.selectTrack(id);
    if (action === "select-program" && id) controller.selectProgram(id);
    if (action === "select-package" && id) controller.selectPackage(id);
    if (action === "select-day" && id) controller.selectDay(id);
    if (action === "go-now") controller.goToNow();
    if (action === "activate-item" && id) handleResult(controller.activateItem(id));
    if (action === "toggle-current") handleResult(controller.toggleCurrent());
    if (action === "add-minute") {
      const result = controller.addMinute();
      handleResult(result);
      if (result.ok) showToast("تمت إضافة دقيقة", () => controller.subtractMinute());
    }
    if (action === "subtract-minute") {
      const result = controller.subtractMinute();
      handleResult(result);
      if (result.ok) showToast("تم إنقاص دقيقة", () => controller.addMinute());
    }
    if (action === "request-reset") {
      const result = controller.requestReset();
      if (!result.ok) showToast("حدد مؤقتًا أولًا");
    }
    if (action === "confirm-reset") handleResult(controller.confirmReset());
    if (action === "cancel-reset") controller.cancelReset();
    if (action === "confirm-conflict") {
      const result = controller.confirmConflict();
      handleResult(result);
      if (result.ok) showToast("تم إيقاف المؤقت السابق. العنصر الجديد جاهز للبدء.");
    }
    if (action === "cancel-conflict") controller.cancelConflict();
    if (action === "previous") handleResult(controller.selectAdjacent("previous"));
    if (action === "next") handleResult(controller.selectAdjacent("next"));
    if (action === "dismiss-completion") controller.dismissCompletion();
    if (action === "open-next") handleResult(controller.openNextFromCompletion());
    if (action === "open-audience") {
      const result = options.openAudience ? await options.openAudience() : audienceSync?.openDisplay("./audience.html");
      if (result && !result.ok) showToast(options.openAudience ? "تعذر فتح نافذة شاشة العرض" : "تعذر فتح شاشة العرض. تحقق من السماح بالنوافذ المنبثقة.");
    }
    if (action === "toggle-overlay") await options.desktopOverlay?.toggle();
    if (action === "enter-focus") controller.setFocusMode(true);
    if (action === "exit-focus") controller.setFocusMode(false);
    if (action === "toggle-settings") settingsOpen = !settingsOpen;
    if (action === "close-settings") settingsOpen = false;
    if (action === "toggle-sound") controller.setSoundEnabled(!controller.getViewModel().soundEnabled);
    if (action === "print-day") {
      const result = await options.printAdapter?.print();
      if (!result?.ok) showToast("تعذر فتح واجهة الطباعة");
    }
    if (action === "install-app") {
      const result = await options.pwa?.install();
      if (!result?.ok) showToast("خيار التثبيت غير متاح في هذا المتصفح");
    }
    if (action === "request-reset-day") controller.requestScopeReset("day");
    if (action === "request-reset-package") controller.requestScopeReset("package");
    if (action === "confirm-scope-reset") {
      const result = controller.confirmScopeReset();
      if (result.ok) showToast(result.scope === "day" ? "تمت إعادة ضبط اليوم" : "تمت إعادة ضبط الحقيبة/البرنامج");
    }
    if (action === "cancel-scope-reset") controller.cancelScopeReset();
    if (action === "undo" && undo) {
      const undoAction = undo;
      undo = null;
      handleResult(undoAction());
    }
    render();
    audienceSync?.publish();
    options.desktopOverlay?.publish();
    wakeLock?.sync(controller.getViewModel().now?.snapshot.status ?? "idle");
    if (persistenceActions.has(action)) persistence?.schedule();
    flushToast();
  });

  document.addEventListener("keydown", (event) => {
    const element = event.target;
    const interactive = element instanceof HTMLElement && (
      ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
      element.isContentEditable ||
      (element.tagName === "BUTTON" && event.code === "Space")
    );
    if (interactive) return;
    if (event.code === "Space") {
      event.preventDefault();
      handleResult(controller.toggleCurrent());
      render();
      audienceSync?.publish();
      options.desktopOverlay?.publish();
      persistence?.schedule();
      wakeLock?.sync(controller.getViewModel().now?.snapshot.status ?? "idle");
      flushToast();
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      controller.requestReset();
      render();
      flushToast();
    }
    if (event.key === "Escape") {
      controller.setFocusMode(false);
      controller.cancelConflict();
      controller.cancelReset();
      controller.dismissCompletion();
      controller.cancelScopeReset();
      settingsOpen = false;
      render();
      audienceSync?.publish();
      options.desktopOverlay?.publish();
      persistence?.schedule();
      flushToast();
    }
  });

  function handleResult(result) {
    if (!result?.ok) {
      if (result?.code !== "ACTIVE_TIMER_CONFLICT") showToast(errorMessage(result?.code));
    }
  }

  function showToast(message, undoAction = null) {
    undo = undoAction;
    pendingToast = { message };
  }

  function flushToast() {
    if (!pendingToast) return;
    const { message } = pendingToast;
    pendingToast = null;
    clearTimeout(toastTimer);
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>${undo ? '<button data-action="undo">تراجع</button>' : ""}`;
    toast.classList.add("visible");
    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
      undo = null;
    }, 4500);
  }

  function render() {
    const view = controller.getViewModel();
    const accent = view.currentDay?.theme.primary ?? selectedTrackTheme(view)?.primary ?? "#16242F";
    root.innerHTML = `
      <div class="app-shell ${view.focusMode ? "focus-mode" : ""}" style="--accent:${safeColor(accent)};--dark:${safeColor(view.currentDay?.theme.dark ?? "#16242F")}">
        ${renderHeader(view, audienceSync?.getConnection(), settingsOpen, options.pwa?.canInstall() ?? false, options.desktopOverlay, wakeLock?.getStatus?.() ?? "unavailable")}
        <main class="main-content">
          ${renderPrintSummary(view)}
          ${renderRoute(view)}
        </main>
        <footer class="app-footer">
          <div class="release-identity" aria-label="${RELEASE_CREDIT}، ${RELEASE_VERSION}">
            <span>${RELEASE_CREDIT}</span><span dir="ltr">${RELEASE_VERSION}</span>
          </div>
        </footer>
        ${renderDialogs(view)}
        <div class="toast" id="toast" role="status" aria-live="polite"></div>
      </div>`;
    updateDocumentTitle(view);
    lastStatus = view.now?.snapshot.status ?? null;
  }

  function frame(timestamp) {
    if (timestamp - lastFrame >= 250) {
      lastFrame = timestamp;
      controller.reconcile();
      const view = controller.getViewModel();
      const alertEvents = options.alerts?.manager.observe(view.now?.snapshot ?? null) ?? [];
      const status = view.now?.snapshot.status ?? null;
      const connectionStatus = audienceSync?.heartbeat().status ?? "not-opened";
      if (status !== lastStatus || view.completion || connectionStatus !== lastConnectionStatus) {
        const timerChanged = status !== lastStatus;
        lastConnectionStatus = connectionStatus;
        render();
        audienceSync?.publish();
        options.desktopOverlay?.publish();
        if (timerChanged) {
          persistence?.schedule();
          wakeLock?.sync(status ?? "idle");
        }
      } else {
        refreshLive(view);
      }
      for (const alertEvent of alertEvents) {
        options.alerts?.presenter.present(alertEvent, { soundEnabled: view.soundEnabled, notify: showToast });
      }
      if (alertEvents.length) flushToast();
    }
    requestAnimationFrame(frame);
  }

  render();
  wakeLock?.subscribe?.(() => render());
  if (options.recoveryNotice) {
    showToast(options.recoveryNotice);
    flushToast();
  }
  wakeLock?.sync(controller.getViewModel().now?.snapshot.status ?? "idle");
  requestAnimationFrame(frame);
  return Object.freeze({ notify: (message) => { showToast(message); flushToast(); }, rerender: render });
}

function renderHeader(view, connection, settingsOpen, canInstall, desktopOverlay, wakeLockStatus) {
  return `
    <header class="app-header">
      <div class="institutional-bar" aria-label="الهوية المؤسسية للبرنامج">
        <img src="./assets/identity/institutional-logos.png" alt="شعارات المعهد الوطني للتطوير المهني التعليمي، وبرنامج تنمية القدرات البشرية، ورؤية السعودية 2030" />
      </div>
      <div class="header-content">
        <div class="header-title-row">
          <div class="brand">
            <button class="brand-mark" data-action="home" aria-label="العودة إلى المسارات">وقت</button>
            <div class="brand-copy"><p>مؤقت البرنامج المهني لسفراء القيادة</p><h1>مؤقت الحقائب التدريبية</h1></div>
          </div>
          <button class="now-chip ${view.running ? "is-running" : ""}" data-action="go-now" ${view.now ? "" : "disabled"}>
            <span>الآن</span>
            <strong data-live-header>${view.now ? `${escapeHtml(view.now.context.officialCode)} · ${view.now.timeText}` : "لم يبدأ أي مؤقت بعد"}</strong>
          </button>
        </div>
        <div class="header-operations" aria-label="أدوات تشغيل التطبيق">
          <div class="display-tools">
            <button class="display-button" data-action="open-audience">فتح شاشة العرض</button>
            ${desktopOverlay ? `<button class="display-button overlay-toggle" data-action="toggle-overlay">${desktopOverlay.isVisible() ? "إخفاء المؤقت العائم" : "إظهار المؤقت العائم"}</button>` : ""}
            ${view.route === "facilitator" ? `<button class="focus-button" data-action="${view.focusMode ? "exit-focus" : "enter-focus"}">${view.focusMode ? "إنهاء وضع التركيز" : "وضع التركيز"}</button>` : ""}
            <button class="settings-button" data-action="toggle-settings" aria-expanded="${settingsOpen}">الإعدادات</button>
          </div>
          <div class="runtime-statuses">
            <span class="wake-lock-status wake-lock-${escapeAttr(wakeLockStatus)}">${escapeHtml(wakeLockLabel(wakeLockStatus))}</span>
            <span class="connection-status status-${escapeAttr(connection?.status ?? "not-opened")}">شاشة العرض: ${escapeHtml(connection?.label ?? "غير مفتوحة")}</span>
          </div>
        </div>
        ${view.breadcrumbs.length > 1 ? `<nav class="breadcrumbs" aria-label="مسار التنقل">${view.breadcrumbs.map((crumb, index) => `<span>${index ? "‹" : ""}</span><button data-action="${breadcrumbAction(crumb.action)}" data-id="${escapeAttr(crumb.id)}" ${index === view.breadcrumbs.length - 1 ? "aria-current=page" : ""}>${escapeHtml(crumb.label)}</button>`).join("")}</nav>` : ""}
      </div>
      ${settingsOpen ? renderSettings(view, canInstall) : ""}
    </header>`;
}

function wakeLockLabel(status) {
  if (status === "active") return "الشاشة ستبقى مضاءة";
  if (status === "requesting") return "جارٍ تثبيت إضاءة الشاشة";
  if (status === "interrupted") return "حماية الشاشة متوقفة مؤقتًا";
  if (status === "inactive") return "حماية الشاشة عند بدء المؤقت";
  return "اضبط القفل التلقائي يدويًا";
}

function renderSettings(view, canInstall) {
  return `<section class="settings-popover" aria-label="الإعدادات">
    <header><strong>الإعدادات</strong><button data-action="close-settings" aria-label="إغلاق">×</button></header>
    <button data-action="toggle-sound">الصوت: ${view.soundEnabled ? "مفعّل" : "متوقف"}</button>
    ${canInstall ? '<button data-action="install-app">تثبيت التطبيق</button>' : ""}
    ${view.currentDay ? '<button data-action="print-day">طباعة جدول اليوم</button><button data-action="request-reset-day">إعادة ضبط اليوم</button><button class="danger" data-action="request-reset-package">إعادة ضبط الحقيبة/البرنامج</button>' : ""}
  </section>`;
}

function renderPrintSummary(view) {
  if (!view.currentDay) return "";
  return `<header class="print-summary"><h1>جدول اليوم</h1><p>${view.breadcrumbs.slice(1).map((crumb) => escapeHtml(crumb.label)).join(" · ")}</p></header>`;
}

function renderRoute(view) {
  if (view.route === "tracks") return renderChoiceScreen("اختر المسار", "ابدأ من المسار الذي تعمل عليه الآن.", view.tracks.map((track) => ({ id: track.id, title: track.title, action: "select-track", color: track.theme.primary })));
  if (view.route === "programs") return renderChoiceScreen("اختر البرنامج", "البرامج المتاحة داخل المسار المحدد.", view.programs.map((program) => ({ id: program.id, title: program.title, action: "select-program" })));
  if (view.route === "packages") return renderChoiceScreen("اختر الحقيبة", "اختر الإصدار التشغيلي المطلوب.", view.packages.map((pkg) => ({ id: pkg.id, title: `الحقيبة ${pkg.code}`, action: "select-package" })));
  if (view.route === "days") return renderChoiceScreen("اختر اليوم", "اختر يوم التشغيل الحالي.", view.days.map((day) => ({ id: day.id, title: `اليوم ${day.order === 1 ? "الأول" : "الثاني"}`, action: "select-day", meta: `${day.canonicalTotalMinutes} دقيقة` })));
  return renderFacilitator(view);
}

function renderChoiceScreen(title, subtitle, choices) {
  return `<section class="choice-screen"><div class="section-heading"><p class="eyebrow">خطوة تشغيلية</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><div class="choice-grid">${choices.map((choice) => `<button class="choice-card" data-action="${choice.action}" data-id="${escapeAttr(choice.id)}" ${choice.color ? `style="--card-accent:${safeColor(choice.color)}"` : ""}><span>${escapeHtml(choice.title)}</span>${choice.meta ? `<small>${escapeHtml(choice.meta)}</small>` : ""}<b aria-hidden="true">←</b></button>`).join("")}</div></section>`;
}

function renderFacilitator(view) {
  const day = view.currentDay;
  if (!day) return "";
  return `
    <section class="facilitator-layout">
      <aside class="timer-panel">
        ${renderNowPanel(view.now, day.theme)}
      </aside>
      <section class="day-panel">
        <div class="day-heading">
          <div><p class="eyebrow">تسلسل اليوم</p><h2>${escapeHtml(day.title)}</h2></div>
          <div class="day-total"><strong>${day.canonicalTotalMinutes}</strong><span>دقيقة Canonical</span></div>
        </div>
        ${day.hasCanonicalMismatch ? '<p class="data-note">⚠ يوجد اختلاف بين الخطة العامة والبيانات التفصيلية</p>' : ""}
        <div class="session-list">${day.sessions.map(renderSession).join("")}</div>
      </section>
    </section>`;
}

function renderNowPanel(now, theme) {
  if (!now) {
    return `<div class="now-panel empty"><p class="eyebrow">الآن</p><h2>لم يبدأ أي مؤقت بعد</h2><p>اختر «تشغيل» من أحد الأجزاء الزمنية في تسلسل اليوم.</p></div>`;
  }
  const snapshot = now.snapshot;
  const primaryAction = snapshot.status === "running" ? "إيقاف مؤقت" : snapshot.status === "paused" ? "استئناف" : snapshot.status === "idle" ? "بدء" : "انتهى الوقت";
  return `
    <div class="now-panel" style="--session-accent:${safeColor(theme.primary)}">
      <p class="eyebrow">الآن · ${escapeHtml(now.statusLabel)}</p>
      <div class="now-context"><span>${escapeHtml(now.context.officialCode)}</span><h2>${escapeHtml(now.context.activityTitle)}</h2>${now.context.segmentTitle ? `<p>${escapeHtml(now.context.segmentTitle)}</p>` : ""}</div>
      <div class="progress-ring" data-live-ring style="--progress:${now.progress * 3.6}deg"><div><strong data-live-time>${now.timeText}</strong><span>متبقي من ${Math.round(snapshot.adjustedDurationMs / 60_000)} دقيقة</span></div></div>
      <div class="primary-controls">
        <button class="control primary" data-action="toggle-current" ${snapshot.status === "completed" ? "disabled" : ""}>${primaryAction}</button>
        <button class="control" data-action="subtract-minute">−1 دقيقة</button>
        <button class="control" data-action="add-minute">+1 دقيقة</button>
        <button class="control" data-action="request-reset">إعادة</button>
      </div>
      <div class="neighbor-row">
        <button class="neighbor" data-action="previous" ${now.previous ? "" : "disabled"}><span>السابق</span><strong>${now.previous ? escapeHtml(now.previous.officialCode) : "—"}</strong></button>
        <button class="neighbor" data-action="next" ${now.next ? "" : "disabled"}><span>${escapeHtml(now.nextRelation)}</span><strong>${now.next ? escapeHtml(now.next.officialCode) : "—"}</strong></button>
      </div>
    </div>`;
}

function renderSession(session) {
  return `
    <article class="session-card" style="--session-accent:${safeColor(session.color)}">
      <header><span>الجلسة ${session.order}</span><div><h3>${escapeHtml(session.title)}</h3><p>${session.canonicalInstructionalMinutes} دقيقة تعليمية</p></div></header>
      <div class="activity-list">${session.activities.map(renderActivity).join("")}</div>
      ${session.unplacedBreaks.map((item) => `<div class="review-break"><span>⚠</span><div><strong>استراحة ${item.durationMinutes} دقيقة</strong><p>موضعها يحتاج اعتمادًا</p></div><em>${item.label}</em></div>`).join("")}
      ${session.externalBreak ? renderTimedRow(session.externalBreak, true) : ""}
    </article>`;
}

function renderActivity(activity) {
  return `
    <details class="activity-card" open>
      <summary><div><b>${escapeHtml(activity.officialCode)}</b><span>${escapeHtml(activity.title)}</span></div><small>${activity.totalMinutes} دقيقة</small></summary>
      <div class="segment-list">
        ${activity.segments.map((segment) => renderTimedRow(segment, false)).join("")}
        ${activity.placedBreaks.map((item) => renderTimedRow(item, true)).join("")}
      </div>
    </details>`;
}

function renderTimedRow(item, isBreak) {
  return `
    <div class="timed-row status-${item.status}" data-item-key="${escapeAttr(item.id)}">
      <span class="state-symbol" aria-hidden="true">${item.symbol}</span>
      <div class="timed-copy"><strong>${escapeHtml(isBreak ? "استراحة" : item.title)}</strong><span>${escapeHtml(item.label)}${item.status === "running" ? ` · <b data-live-list-time>${formatTime(item.remainingMs)}</b>` : ""}</span></div>
      <span class="duration">${item.durationMinutes} د</span>
      ${item.actionLabel ? `<button class="quick-action" data-action="activate-item" data-id="${escapeAttr(item.id)}">${escapeHtml(item.actionLabel)}</button>` : `<span class="complete-label">مكتمل</span>`}
    </div>`;
}

function renderDialogs(view) {
  return `
    ${view.conflict ? `<div class="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><p class="eyebrow">تعارض تشغيل</p><h2 id="conflict-title">يوجد مؤقت جارٍ</h2><p>العنصر المطلوب: ${escapeHtml(view.conflict.target?.officialCode ?? "")}</p><div><button class="control primary" data-action="confirm-conflict">إيقاف الحالي والانتقال</button><button class="control" data-action="cancel-conflict">إلغاء</button></div></section></div>` : ""}
    ${view.resetPending ? `<div class="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title"><p class="eyebrow">تأكيد الإعادة</p><h2 id="reset-title">إعادة المؤقت إلى مدته الأصلية؟</h2><div><button class="control primary" data-action="confirm-reset">إعادة</button><button class="control" data-action="cancel-reset">إلغاء</button></div></section></div>` : ""}
    ${view.scopeResetPending ? `<div class="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="scope-reset-title"><p class="eyebrow">إعادة ضبط نطاق</p><h2 id="scope-reset-title">${view.scopeResetPending === "day" ? "مسح تقدم هذا اليوم؟" : "مسح تقدم الحقيبة/البرنامج الحالي؟"}</h2><p>${view.scopeResetPending === "day" ? "لن تتأثر الأيام الأخرى." : "هذا تأكيد أقوى؛ لن تتأثر البرامج الأخرى."}</p><div><button class="control primary" data-action="confirm-scope-reset">نعم، إعادة الضبط</button><button class="control" data-action="cancel-scope-reset">إلغاء</button></div></section></div>` : ""}
    ${view.completion ? `<div class="dialog-backdrop"><section class="dialog completion" role="dialog" aria-modal="true" aria-labelledby="completion-title"><p class="eyebrow">00:00</p><h2 id="completion-title">انتهى الوقت</h2>${view.completion.next ? `<div class="next-up"><span>التالي</span><strong>${escapeHtml(view.completion.next.officialCode)}</strong><p>${escapeHtml(view.completion.next.activityTitle)}</p><small>${view.completion.next.durationMinutes} دقيقة</small></div>` : "<p>هذا هو آخر عنصر في اليوم.</p>"}<div>${view.completion.next ? '<button class="control primary" data-action="open-next">فتح التالي</button>' : ""}<button class="control" data-action="dismiss-completion">البقاء هنا</button></div></section></div>` : ""}`;
}

function refreshLive(view) {
  if (!view.now) {
    document.title = DEFAULT_TITLE;
    return;
  }
  document.querySelectorAll("[data-live-time]").forEach((element) => { element.textContent = view.now.timeText; });
  document.querySelectorAll("[data-live-header]").forEach((element) => { element.textContent = `${view.now.context.officialCode} · ${view.now.timeText}`; });
  document.querySelectorAll("[data-live-list-time]").forEach((element) => { element.textContent = view.now.timeText; });
  document.querySelectorAll("[data-live-ring]").forEach((element) => { element.style.setProperty("--progress", `${view.now.progress * 3.6}deg`); });
  document.querySelectorAll("[data-live-bar]").forEach((element) => { element.style.width = `${view.now.progress}%`; });
  updateDocumentTitle(view);
}

function updateDocumentTitle(view) {
  document.title = view.now?.snapshot.status === "running"
    ? `${view.now.timeText} • ${view.now.context.officialCode}`
    : DEFAULT_TITLE;
}

function selectedTrackTheme(view) {
  const selected = view.breadcrumbs.find((crumb) => view.tracks.some((track) => track.id === crumb.id));
  return selected ? view.tracks.find((track) => track.id === selected.id)?.theme : null;
}

function errorMessage(code) {
  if (code === "NO_ITEM_SELECTED") return "حدد عنصرًا زمنيًا أولًا";
  if (code === "COMPLETED_ITEM") return "المؤقت مكتمل؛ استخدم الإعادة أو أضف وقتًا";
  if (code === "NO_ADJACENT_ITEM") return "لا يوجد عنصر في هذا الاتجاه";
  return "تعذر تنفيذ الإجراء";
}

function breadcrumbAction(action) {
  if (action === "home") return "home";
  if (action === "track") return "select-track";
  if (action === "program") return "select-program";
  if (action === "package") return "select-package";
  return "noop";
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#16242F";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
