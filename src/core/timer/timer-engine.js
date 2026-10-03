// @ts-check

/** @typedef {import('./types.js').Clock} Clock */
/** @typedef {import('./types.js').LoadItemOptions} LoadItemOptions */
/** @typedef {import('./types.js').TimerEngine} TimerEngine */
/** @typedef {import('./types.js').TimerErrorCode} TimerErrorCode */
/** @typedef {import('./types.js').TimerItem} TimerItem */
/** @typedef {import('./types.js').TimerResult} TimerResult */
/** @typedef {import('./types.js').TimerSnapshot} TimerSnapshot */
/** @typedef {import('./types.js').TimerSequenceEntry} TimerSequenceEntry */
/** @typedef {import('../../data/types.js').DayNode} DayNode */

const ONE_MINUTE_MS = 60_000;
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now() });
const VALID_STATUSES = new Set(["idle", "running", "paused", "completed"]);

/**
 * Creates one timer authority that can retain snapshots for selected items but
 * never permits more than one running state. It has no rendering, storage,
 * browser, or scheduling dependency.
 *
 * @param {{clock?: Clock}} [options]
 * @returns {TimerEngine}
 */
export function createTimerEngine({ clock = SYSTEM_CLOCK } = {}) {
  if (!clock || typeof clock.now !== "function") {
    throw new TypeError("clock.now() is required");
  }

  /** @type {Map<string, TimerSnapshot>} */
  const states = new Map();
  /** @type {string | null} */
  let selectedKey = null;

  /** @param {TimerItem} item @param {LoadItemOptions} [options] @returns {TimerResult} */
  function loadItem(item, options = {}) {
    const validationError = validateItem(item);
    if (validationError) return failure(validationError);

    const running = findRunningState();
    if (running && running.itemKey !== item.id) {
      return failure("ACTIVE_TIMER_CONFLICT");
    }

    if (options.snapshot) {
      const snapshotError = validateSnapshot(options.snapshot, item);
      if (snapshotError) return failure(snapshotError);
      states.set(item.id, cloneSnapshot(options.snapshot));
    } else if (!states.has(item.id)) {
      const durationMs = minutesToMilliseconds(item.durationMinutes);
      states.set(item.id, {
        itemKey: item.id,
        itemType: item.type,
        originalDurationMs: durationMs,
        adjustedDurationMs: durationMs,
        remainingMs: durationMs,
        status: "idle",
        startedAt: null,
        endAt: null,
        completedAt: null,
      });
    }

    selectedKey = item.id;
    const selected = states.get(item.id);
    if (selected?.status === "running") reconcile(clock.now());
    return success(currentState());
  }

  /** @param {TimerItem} item */
  function selectItem(item) {
    return loadItem(item);
  }

  function start() {
    const state = currentState();
    if (!state) return failure("NO_ITEM_SELECTED");
    if (state.status !== "idle") return failure("INVALID_TRANSITION");
    if (findOtherRunningState(state.itemKey)) return failure("ACTIVE_TIMER_CONFLICT");
    const now = safeNow(clock.now());
    state.status = "running";
    state.startedAt = now;
    state.endAt = now + state.remainingMs;
    state.completedAt = null;
    return success(state);
  }

  function pause() {
    const state = currentState();
    if (!state) return failure("NO_ITEM_SELECTED");
    if (state.status !== "running") return failure("INVALID_TRANSITION");
    reconcile(clock.now());
    if (state.status === "completed") return success(state);
    state.status = "paused";
    state.endAt = null;
    return success(state);
  }

  function resume() {
    const state = currentState();
    if (!state) return failure("NO_ITEM_SELECTED");
    if (state.status !== "paused" || state.remainingMs <= 0) return failure("INVALID_TRANSITION");
    if (findOtherRunningState(state.itemKey)) return failure("ACTIVE_TIMER_CONFLICT");
    const now = safeNow(clock.now());
    state.status = "running";
    state.endAt = now + state.remainingMs;
    state.completedAt = null;
    return success(state);
  }

  function reset() {
    const state = currentState();
    if (!state) return failure("NO_ITEM_SELECTED");
    state.adjustedDurationMs = state.originalDurationMs;
    state.remainingMs = state.originalDurationMs;
    state.status = "idle";
    state.startedAt = null;
    state.endAt = null;
    state.completedAt = null;
    return success(state);
  }

  /** @param {number} [milliseconds] */
  function addTime(milliseconds = ONE_MINUTE_MS) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return failure("INVALID_ADJUSTMENT");
    return adjustTime(milliseconds);
  }

  /** @param {number} [milliseconds] */
  function subtractTime(milliseconds = ONE_MINUTE_MS) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return failure("INVALID_ADJUSTMENT");
    return adjustTime(-milliseconds);
  }

  /** @param {number} deltaMs */
  function adjustTime(deltaMs) {
    const state = currentState();
    if (!state) return failure("NO_ITEM_SELECTED");
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return failure("INVALID_ADJUSTMENT");

    const now = safeNow(clock.now());
    if (state.status === "running") reconcile(now);

    if (state.status === "completed" && deltaMs > 0) {
      state.adjustedDurationMs = Math.max(0, state.adjustedDurationMs + deltaMs);
      state.remainingMs = deltaMs;
      state.status = "paused";
      state.endAt = null;
      state.completedAt = null;
      return success(state);
    }
    if (state.status === "completed") {
      state.adjustedDurationMs = Math.max(0, state.adjustedDurationMs + deltaMs);
      return success(state);
    }

    state.adjustedDurationMs = Math.max(0, state.adjustedDurationMs + deltaMs);
    state.remainingMs = Math.max(0, state.remainingMs + deltaMs);

    if (state.remainingMs === 0) {
      markCompleted(state, now);
    } else if (state.status === "running") {
      state.endAt = now + state.remainingMs;
    }
    return success(state);
  }

  function complete() {
    const state = currentState();
    if (!state) return failure("NO_ITEM_SELECTED");
    markCompleted(state, safeNow(clock.now()));
    return success(state);
  }

  function getSnapshot() {
    const state = currentState();
    if (!state) return null;
    if (state.status === "running") reconcile(clock.now());
    return cloneSnapshot(state);
  }

  /** @param {string} itemKey */
  function getItemSnapshot(itemKey) {
    const state = states.get(itemKey);
    if (!state) return null;
    if (state.status === "running" && state.itemKey === selectedKey) reconcile(clock.now());
    return cloneSnapshot(state);
  }

  function getSnapshots() {
    const running = findRunningState();
    if (running?.itemKey === selectedKey) reconcile(clock.now());
    return [...states.values()].map(cloneSnapshot);
  }

  function getRunningSnapshot() {
    const running = findRunningState();
    if (!running) return null;
    if (running.itemKey === selectedKey) reconcile(clock.now());
    const currentRunning = findRunningState();
    return currentRunning ? cloneSnapshot(currentRunning) : null;
  }

  /** @param {string[]} itemKeys */
  function clearSnapshots(itemKeys) {
    if (!Array.isArray(itemKeys)) throw new TypeError("itemKeys must be an array");
    const keys = new Set(itemKeys);
    let cleared = 0;
    for (const key of keys) {
      if (states.delete(key)) cleared += 1;
    }
    if (selectedKey && keys.has(selectedKey)) selectedKey = null;
    return cleared;
  }

  /** @param {number} [now] */
  function reconcile(now = clock.now()) {
    const state = currentState();
    if (!state) return null;
    const safeTimestamp = safeNow(now);
    if (state.status !== "running") return cloneSnapshot(state);
    if (state.endAt == null) {
      throw new Error("Invariant violation: running timer requires endAt");
    }
    const scheduledEndAt = state.endAt;
    state.remainingMs = Math.max(0, scheduledEndAt - safeTimestamp);
    if (state.remainingMs === 0) {
      markCompleted(state, scheduledEndAt);
    }
    return cloneSnapshot(state);
  }

  /** @returns {TimerSnapshot | undefined} */
  function findRunningState() {
    return [...states.values()].find((state) => state.status === "running");
  }

  /** @param {string} itemKey @returns {TimerSnapshot | undefined} */
  function findOtherRunningState(itemKey) {
    return [...states.values()].find((state) => state.status === "running" && state.itemKey !== itemKey);
  }

  /** @returns {TimerSnapshot | null} */
  function currentState() {
    return selectedKey ? states.get(selectedKey) ?? null : null;
  }

  /** @param {TimerErrorCode} code @returns {TimerResult} */
  function failure(code) {
    const state = currentState();
    return { ok: false, code, snapshot: state ? cloneSnapshot(state) : null };
  }

  return Object.freeze({
    loadItem,
    selectItem,
    start,
    pause,
    resume,
    reset,
    addTime,
    subtractTime,
    complete,
    getSnapshot,
    getItemSnapshot,
    getSnapshots,
    getRunningSnapshot,
    clearSnapshots,
    reconcile,
  });
}

/** @param {TimerItem} item @returns {TimerErrorCode | null} */
function validateItem(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || (item.type !== "segment" && item.type !== "break")) {
    return "INVALID_ITEM";
  }
  if (item.type === "break" && "placementStatus" in item && item.placementStatus === "unresolved") {
    return "UNRESOLVED_BREAK";
  }
  if (item.timerEligible !== true) return "ITEM_NOT_ELIGIBLE";
  if (!Number.isFinite(item.durationMinutes) || item.durationMinutes <= 0) return "INVALID_DURATION";
  return null;
}

/** @param {TimerSnapshot} snapshot @param {TimerItem} item @returns {TimerErrorCode | null} */
function validateSnapshot(snapshot, item) {
  if (!snapshot || typeof snapshot !== "object") return "INVALID_SNAPSHOT";
  if (snapshot.itemKey !== item.id || snapshot.itemType !== item.type) return "SNAPSHOT_ITEM_MISMATCH";
  if (!VALID_STATUSES.has(snapshot.status)) return "INVALID_SNAPSHOT";
  const numbers = [snapshot.originalDurationMs, snapshot.adjustedDurationMs, snapshot.remainingMs];
  if (numbers.some((value) => !Number.isFinite(value) || value < 0) || snapshot.originalDurationMs <= 0) {
    return "INVALID_SNAPSHOT";
  }
  if (snapshot.status === "running" && (!Number.isFinite(snapshot.endAt) || snapshot.endAt == null)) {
    return "INVALID_SNAPSHOT";
  }
  if (snapshot.status !== "running" && snapshot.endAt != null) return "INVALID_SNAPSHOT";
  if (snapshot.status === "idle" && snapshot.remainingMs !== snapshot.adjustedDurationMs) return "INVALID_SNAPSHOT";
  if (snapshot.status === "completed" && (snapshot.remainingMs !== 0 || !Number.isFinite(snapshot.completedAt))) {
    return "INVALID_SNAPSHOT";
  }
  if (snapshot.status !== "completed" && snapshot.completedAt != null) return "INVALID_SNAPSHOT";
  return null;
}

/** @param {TimerSnapshot} state @param {number} completedAt */
function markCompleted(state, completedAt) {
  state.status = "completed";
  state.remainingMs = 0;
  state.endAt = null;
  state.completedAt = completedAt;
}

/** @param {TimerSnapshot | null} state @returns {TimerResult} */
function success(state) {
  if (!state) throw new Error("Invariant violation: success requires timer state");
  return { ok: true, snapshot: cloneSnapshot(state) };
}

/** @param {TimerSnapshot} state @returns {TimerSnapshot} */
function cloneSnapshot(state) {
  return { ...state };
}

/** @param {number} minutes */
function minutesToMilliseconds(minutes) {
  return Math.round(minutes * ONE_MINUTE_MS);
}

/** @param {number} timestamp */
function safeNow(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError("clock.now() must return a non-negative finite number");
  return timestamp;
}

/**
 * Builds the deterministic operational order for one validated day. Unplaced
 * breaks are deliberately absent until their source position is approved.
 *
 * @param {DayNode} day
 * @returns {TimerSequenceEntry[]}
 */
export function buildTimerSequence(day) {
  if (!day || !Array.isArray(day.sessions) || !Array.isArray(day.externalBreaks)) {
    throw new TypeError("A validated DayNode is required");
  }

  /** @type {TimerItem[]} */
  const items = [];
  const externalBySession = groupBy(day.externalBreaks, (item) => item.afterSession);

  for (const session of [...day.sessions].sort(byOrder)) {
    const placedBySegment = groupBy(session.placedBreaks, (item) => item.afterSegmentId ?? "");
    for (const activity of [...session.activities].sort(byOrder)) {
      for (const segment of [...activity.segments].sort(byOrder)) {
        if (segment.timerEligible) items.push(segment);
        for (const breakItem of placedBySegment.get(segment.sourceId) ?? []) {
          if (breakItem.timerEligible) items.push(breakItem);
        }
      }
    }
    for (const breakItem of externalBySession.get(session.order) ?? []) {
      if (breakItem.timerEligible) items.push(breakItem);
    }
  }

  return items.map((item, index) => ({
    item,
    previousKey: items[index - 1]?.id ?? null,
    nextKey: items[index + 1]?.id ?? null,
  }));
}

/** @param {TimerSequenceEntry[]} sequence @param {string} itemKey */
export function getTimerNeighbors(sequence, itemKey) {
  const index = sequence.findIndex((entry) => entry.item.id === itemKey);
  if (index < 0) return null;
  return {
    previous: sequence[index - 1]?.item ?? null,
    current: sequence[index].item,
    next: sequence[index + 1]?.item ?? null,
  };
}

/** @template T @param {T[]} items @param {(item:T)=>string|number} keyOf */
function groupBy(items, keyOf) {
  /** @type {Map<string|number, T[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/** @param {{order:number}} left @param {{order:number}} right */
function byOrder(left, right) {
  return left.order - right.order;
}
