// @ts-check

/** @param {HTMLElement} root @param {import('../../core/audience/types.js').AudienceState} initialState @param {{clock?: {now(): number}, documentRef?: Document, requestFrame?: typeof requestAnimationFrame, wakeLock?: {sync(status:string):unknown, getStatus?():string, subscribe?(listener:(status:string)=>void):()=>void}}} [options] */
export function mountAudienceDisplay(root, initialState, options = {}) {
  const clock = options.clock ?? { now: () => Date.now() };
  const documentRef = options.documentRef ?? document;
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const wakeLock = options.wakeLock;
  let state = initialState;
  let lastSecond = null;

  root.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action="fullscreen"]') : null;
    if (!target) return;
    await toggleFullscreen(documentRef);
  });

  function setState(nextState) {
    state = nextState;
    render();
    void wakeLock?.sync(state.status);
  }

  function render() {
    const display = deriveAudienceDisplay(state, clock.now());
    root.innerHTML = `
      <section class="audience-screen status-${escapeAttr(state.status)}" style="--primary:${safeColor(state.theme.primary)};--dark:${safeColor(state.theme.dark)}">
        <button class="fullscreen-button" data-action="fullscreen">ملء الشاشة</button>
        ${renderWakeLockStatus(wakeLock?.getStatus?.() ?? "unavailable")}
        <div class="audience-content">
          ${state.itemKey ? renderActive(display) : renderWaiting()}
        </div>
      </section>`;
    documentRef.title = state.itemKey ? `${display.timeText} • ${state.officialCode}` : "شاشة العرض";
    lastSecond = Math.ceil(display.remainingMs / 1000);
  }

  function frame() {
    const display = deriveAudienceDisplay(state, clock.now());
    const second = Math.ceil(display.remainingMs / 1000);
    if (second !== lastSecond) {
      lastSecond = second;
      const time = root.querySelector("[data-audience-time]");
      const progress = root.querySelector("[data-audience-progress]");
      if (time) time.textContent = display.timeText;
      if (progress) progress.style.width = `${display.progress}%`;
    }
    requestFrame(frame);
  }

  render();
  wakeLock?.subscribe?.(() => render());
  void wakeLock?.sync(state.status);
  requestFrame(frame);
  return Object.freeze({ setState, getState: () => state });
}

function renderWakeLockStatus(status) {
  const labels = {
    active: "الشاشة ستبقى مضاءة",
    requesting: "جارٍ تثبيت إضاءة الشاشة",
    interrupted: "حماية الشاشة متوقفة مؤقتًا",
    unavailable: "اضبط القفل التلقائي يدويًا",
    inactive: "حماية الشاشة عند بدء المؤقت",
  };
  return `<div class="audience-wake-lock wake-lock-${escapeAttr(status)}" role="status">${escapeHtml(labels[status] ?? labels.unavailable)}</div>`;
}

export function deriveAudienceDisplay(state, now = Date.now()) {
  const messageAgeMs = Math.max(0, now - state.sentAt);
  const remainingAtSend = state.endAt === null ? state.remainingMs : Math.max(0, state.endAt - state.sentAt);
  const remainingMs = state.status === "running" && state.endAt !== null
    ? Math.max(0, remainingAtSend - messageAgeMs)
    : Math.max(0, state.remainingMs);
  const potentialDriftMs = state.status === "running"
    ? Math.abs(Math.max(0, state.remainingMs) - remainingAtSend)
    : 0;
  const elapsed = Math.max(0, state.durationMs - remainingMs);
  const progress = state.durationMs > 0 ? Math.min(100, (elapsed / state.durationMs) * 100) : 0;
  return { ...state, remainingMs, progress, timeText: formatAudienceTime(remainingMs), messageAgeMs, potentialDriftMs };
}

export async function toggleFullscreen(documentRef) {
  try {
    if (documentRef.fullscreenElement) await documentRef.exitFullscreen?.();
    else await documentRef.documentElement?.requestFullscreen?.();
    return true;
  } catch {
    return false;
  }
}

function renderActive(display) {
  const isBreak = display.itemType === "break";
  return `
    <p class="audience-session">${escapeHtml(display.sessionTitle)}</p>
    <div class="audience-code">${escapeHtml(isBreak ? "استراحة" : display.officialCode)}</div>
    <h1>${escapeHtml(isBreak ? "استراحة" : display.activityTitle)}</h1>
    ${display.showSegmentTitle ? `<p class="audience-segment">${escapeHtml(display.segmentTitle)}</p>` : ""}
    <strong class="audience-time" data-audience-time>${display.timeText}</strong>
    <div class="audience-progress" aria-label="التقدم"><i data-audience-progress style="width:${display.progress}%"></i></div>
    <p class="audience-status">${statusText(display.status)}</p>`;
}

function renderWaiting() {
  return `<div class="audience-waiting"><span>شاشة العرض</span><h1>بانتظار بدء النشاط</h1><p>ستظهر هنا حالة المؤقت من شاشة الميسر.</p></div>`;
}

function statusText(status) {
  if (status === "running") return "جارٍ الآن";
  if (status === "paused") return "متوقف مؤقتًا";
  if (status === "completed") return "انتهى الوقت";
  return "جاهز للبدء";
}

function formatAudienceTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#16242F"; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
