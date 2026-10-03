// @ts-check

const DEFAULT_THEME = Object.freeze({ primary: "#C3943F", dark: "#16242F" });

/**
 * Converts the facilitator view into the deliberately small, versioned display contract.
 * The audience never receives the validated dataset or a Timer Engine reference.
 *
 * @param {ReturnType<import('../../ui/facilitator/facilitator-controller.js').createFacilitatorController>['getViewModel'] extends (...args: any[]) => infer T ? T : never} view
 * @param {number} sentAt
 * @returns {import('./types.js').AudienceState}
 */
export function createAudienceState(view, sentAt = Date.now()) {
  const now = view.now;
  if (!now) return emptyAudienceState(sentAt, selectedTheme(view));

  const context = now.context;
  if (context.timerEligible === false || context.placementStatus === "unresolved") {
    throw new Error("UNRESOLVED_ITEM_NOT_ALLOWED");
  }

  const durationMs = now.snapshot.adjustedDurationMs || now.snapshot.originalDurationMs;
  const segmentTitle = context.itemType === "break" ? "" : context.segmentTitle;
  const distinctSegmentTitle = normalize(segmentTitle) !== normalize(context.activityTitle);

  return Object.freeze({
    version: 1,
    sentAt,
    status: now.snapshot.status,
    itemKey: now.snapshot.itemKey,
    itemType: now.snapshot.itemType,
    officialCode: context.officialCode,
    activityTitle: context.activityTitle,
    segmentTitle,
    showSegmentTitle: Boolean(segmentTitle && distinctSegmentTitle),
    sessionTitle: context.sessionTitle,
    durationMs,
    remainingMs: now.snapshot.remainingMs,
    endAt: now.snapshot.endAt,
    progress: clampProgress(now.progress),
    theme: Object.freeze({
      primary: safeColor(context.theme?.primary, DEFAULT_THEME.primary),
      dark: safeColor(context.theme?.dark, DEFAULT_THEME.dark),
    }),
  });
}

export function emptyAudienceState(sentAt = Date.now(), theme = DEFAULT_THEME) {
  return Object.freeze({
    version: 1,
    sentAt,
    status: "idle",
    itemKey: null,
    itemType: null,
    officialCode: "",
    activityTitle: "",
    segmentTitle: "",
    showSegmentTitle: false,
    sessionTitle: "",
    durationMs: 0,
    remainingMs: 0,
    endAt: null,
    progress: 0,
    theme: Object.freeze({
      primary: safeColor(theme?.primary, DEFAULT_THEME.primary),
      dark: safeColor(theme?.dark, DEFAULT_THEME.dark),
    }),
  });
}

export function isAudienceState(value) {
  return Boolean(value && typeof value === "object" && value.version === 1
    && ["idle", "running", "paused", "completed"].includes(value.status)
    && typeof value.sentAt === "number" && value.theme && typeof value.theme.primary === "string");
}

function selectedTheme(view) {
  return view.now?.context.theme ?? view.currentDay?.theme ?? DEFAULT_THEME;
}

function clampProgress(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
}
