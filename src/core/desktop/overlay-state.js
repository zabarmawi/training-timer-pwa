// @ts-check

export const OVERLAY_EVENT = "training-timer:overlay-state";
export const OVERLAY_READY_EVENT = "training-timer:overlay-ready";
export const OVERLAY_VISIBILITY_EVENT = "training-timer:overlay-visibility";
export const OVERLAY_VISIBILITY_CHANGED_EVENT = "training-timer:overlay-visibility-changed";
export const OVERLAY_MODES = Object.freeze(["minimal", "compact", "detailed"]);

/** @param {import('../audience/types.js').AudienceState | Record<string, any>} state */
export function createOverlayState(state) {
  return Object.freeze({
    version: 1,
    sentAt: Number(state.sentAt) || Date.now(),
    itemKey: state.itemKey ?? null,
    status: state.status,
    officialCode: String(state.officialCode ?? ""),
    activityTitle: String(state.activityTitle ?? ""),
    segmentTitle: String(state.segmentTitle ?? ""),
    sessionTitle: String(state.sessionTitle ?? ""),
    durationMs: Math.max(0, Number(state.durationMs) || 0),
    remainingMs: Math.max(0, Number(state.remainingMs) || 0),
    endAt: typeof state.endAt === "number" ? state.endAt : null,
    progress: clamp(Number(state.progress) || 0, 0, 100),
    theme: Object.freeze({
      primary: safeColor(state.theme?.primary, "#C3943F"),
      dark: safeColor(state.theme?.dark, "#16242F"),
    }),
  });
}

export function isOverlayState(value) {
  return Boolean(value && typeof value === "object" && value.version === 1
    && ["idle", "running", "paused", "completed"].includes(value.status)
    && typeof value.remainingMs === "number" && value.theme);
}

export function deriveOverlayView(state, now = Date.now()) {
  const remainingMs = state.status === "running" && typeof state.endAt === "number"
    ? Math.max(0, state.endAt - now)
    : Math.max(0, state.remainingMs);
  const progress = state.durationMs > 0
    ? clamp(((state.durationMs - remainingMs) / state.durationMs) * 100, 0, 100)
    : state.progress;
  return Object.freeze({ ...state, remainingMs, progress, timeText: formatOverlayTime(remainingMs) });
}

export function formatOverlayTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
