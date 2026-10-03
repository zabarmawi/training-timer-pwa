// @ts-check

import { buildTimerSequence, getTimerNeighbors } from "../../core/timer/timer-engine.js";

const STATUS_META = Object.freeze({
  pending: { label: "لم يبدأ", symbol: "○" },
  idle: { label: "لم يبدأ", symbol: "○" },
  running: { label: "جارٍ الآن", symbol: "▶" },
  paused: { label: "متوقف مؤقتًا", symbol: "◐" },
  completed: { label: "مكتمل", symbol: "✓" },
  review: { label: "يحتاج مراجعة", symbol: "⚠" },
});

/**
 * UI-facing state coordinator. It owns navigation and interaction intent, but
 * delegates every time calculation and transition to Timer Engine.
 *
 * @param {import('../../data/types.js').RuntimeDataset} model
 * @param {import('../../core/timer/types.js').TimerEngine} engine
 */
export function createFacilitatorController(model, engine) {
  const index = buildModelIndex(model);
  let route = "tracks";
  let trackId = null;
  let programId = null;
  let packageId = null;
  let dayId = null;
  let conflictItemKey = null;
  let resetPending = false;
  let completionItemKey = null;
  let observedTimerStatus = null;
  let focusMode = false;
  let soundEnabled = true;
  let scopeResetPending = null;

  function selectTrack(nextTrackId) {
    if (!index.tracks.has(nextTrackId)) return notFound();
    trackId = nextTrackId;
    programId = packageId = dayId = null;
    route = "programs";
    return ok();
  }

  function selectProgram(nextProgramId) {
    const program = index.programs.get(nextProgramId);
    if (!program || program.track.id !== trackId) return notFound();
    programId = nextProgramId;
    packageId = dayId = null;
    route = program.node.structure === "packages" ? "packages" : "days";
    return ok();
  }

  function selectPackage(nextPackageId) {
    const pkg = index.packages.get(nextPackageId);
    if (!pkg || pkg.program.id !== programId) return notFound();
    packageId = nextPackageId;
    dayId = null;
    route = "days";
    return ok();
  }

  function selectDay(nextDayId) {
    const day = index.days.get(nextDayId);
    if (!day || day.program.id !== programId || (packageId && day.package?.id !== packageId)) return notFound();
    dayId = nextDayId;
    route = "facilitator";
    return ok();
  }

  function goHome() {
    route = "tracks";
    trackId = programId = packageId = dayId = null;
    return ok();
  }

  function goToNow() {
    const snapshot = engine.getSnapshot();
    if (!snapshot) return { ok: false, code: "NO_ITEM_SELECTED" };
    const context = index.items.get(snapshot.itemKey);
    if (!context) return notFound();
    trackId = context.track.id;
    programId = context.program.id;
    packageId = context.package?.id ?? null;
    dayId = context.day.id;
    route = "facilitator";
    return ok();
  }

  function activateItem(itemKey) {
    const context = index.items.get(itemKey);
    if (!context || !context.sequenceMember) return notFound();
    const loaded = engine.loadItem(context.item);
    if (!loaded.ok) {
      if (loaded.code === "ACTIVE_TIMER_CONFLICT") conflictItemKey = itemKey;
      return loaded;
    }
    if (loaded.snapshot.status === "idle") return remember(engine.start());
    if (loaded.snapshot.status === "paused") return remember(engine.resume());
    if (loaded.snapshot.status === "running") return remember(engine.pause());
    return { ok: false, code: "COMPLETED_ITEM", snapshot: loaded.snapshot };
  }

  function confirmConflict() {
    if (!conflictItemKey) return { ok: false, code: "NO_PENDING_CONFLICT" };
    const target = index.items.get(conflictItemKey);
    if (!target) return notFound();
    const running = engine.getRunningSnapshot();
    if (running) {
      engine.loadItem(index.items.get(running.itemKey).item);
      engine.pause();
    }
    const result = engine.loadItem(target.item);
    conflictItemKey = null;
    return remember(result);
  }

  function cancelConflict() {
    conflictItemKey = null;
    return ok();
  }

  function toggleCurrent() {
    const snapshot = engine.getSnapshot();
    if (!snapshot) return { ok: false, code: "NO_ITEM_SELECTED" };
    if (snapshot.status === "idle") return remember(engine.start());
    if (snapshot.status === "running") return remember(engine.pause());
    if (snapshot.status === "paused") return remember(engine.resume());
    return { ok: false, code: "INVALID_TRANSITION", snapshot };
  }

  function addMinute() {
    return remember(engine.addTime());
  }

  function subtractMinute() {
    return remember(engine.subtractTime());
  }

  function requestReset() {
    const snapshot = engine.getSnapshot();
    if (!snapshot) return { ok: false, code: "NO_ITEM_SELECTED" };
    const requiresConfirmation = snapshot.status !== "idle" || snapshot.adjustedDurationMs !== snapshot.originalDurationMs;
    if (!requiresConfirmation) return engine.reset();
    resetPending = true;
    return { ok: true, requiresConfirmation: true, snapshot };
  }

  function confirmReset() {
    if (!resetPending) return { ok: false, code: "NO_PENDING_RESET" };
    resetPending = false;
    completionItemKey = null;
    return remember(engine.reset());
  }

  function cancelReset() {
    resetPending = false;
    return ok();
  }

  function selectAdjacent(direction) {
    const snapshot = engine.getSnapshot();
    if (!snapshot) return { ok: false, code: "NO_ITEM_SELECTED" };
    const context = index.items.get(snapshot.itemKey);
    if (!context) return notFound();
    const neighbors = getTimerNeighbors(context.sequence, snapshot.itemKey);
    const target = direction === "previous" ? neighbors?.previous : neighbors?.next;
    if (!target) return { ok: false, code: "NO_ADJACENT_ITEM" };
    const result = engine.loadItem(target);
    if (!result.ok && result.code === "ACTIVE_TIMER_CONFLICT") conflictItemKey = target.id;
    return remember(result);
  }

  function reconcile() {
    const beforeStatus = observedTimerStatus;
    const after = engine.reconcile();
    if (beforeStatus === "running" && after?.status === "completed") {
      completionItemKey = after.itemKey;
    }
    observedTimerStatus = after?.status ?? null;
    return after;
  }

  function dismissCompletion() {
    completionItemKey = null;
    return ok();
  }

  function setFocusMode(enabled) {
    focusMode = Boolean(enabled);
    return ok();
  }

  function setSoundEnabled(enabled) {
    soundEnabled = Boolean(enabled);
    return ok();
  }

  function requestScopeReset(scope) {
    if (scope === "day" && dayId) scopeResetPending = "day";
    else if (scope === "package" && programId) scopeResetPending = "package";
    else return { ok: false, code: "INVALID_RESET_SCOPE" };
    return { ok: true, scope: scopeResetPending };
  }

  function cancelScopeReset() {
    scopeResetPending = null;
    return ok();
  }

  function confirmScopeReset() {
    if (!scopeResetPending) return { ok: false, code: "NO_PENDING_SCOPE_RESET" };
    const scope = scopeResetPending;
    const keys = [...index.items.entries()]
      .filter(([, context]) => scope === "day"
        ? context.node.id === dayId
        : packageId ? context.package?.id === packageId : context.program.id === programId)
      .map(([key]) => key);
    const cleared = engine.clearSnapshots(keys);
    scopeResetPending = null;
    completionItemKey = null;
    observedTimerStatus = null;
    return { ok: true, scope, cleared };
  }

  function getPersistenceContext() {
    return {
      route,
      trackId,
      programId,
      packageId,
      dayId,
      selectedItemKey: engine.getSnapshot()?.itemKey ?? null,
      focusMode,
      soundEnabled,
    };
  }

  function restorePersistenceContext(state) {
    route = "tracks";
    trackId = programId = packageId = dayId = null;
    focusMode = state.focusMode === true;
    soundEnabled = state.soundEnabled !== false;
    if (!state.trackId || !index.tracks.has(state.trackId)) return ok();
    selectTrack(state.trackId);
    if (state.route === "programs" || !state.programId) return ok();
    const programResult = selectProgram(state.programId);
    if (!programResult.ok || state.route === "packages") return ok();
    const program = index.programs.get(state.programId);
    if (program?.node.structure === "packages") {
      if (!state.packageId || !selectPackage(state.packageId).ok) return ok();
      if (state.route === "days" || !state.dayId) return ok();
    }
    if (state.dayId) selectDay(state.dayId);
    return ok();
  }

  function openNextFromCompletion() {
    if (!completionItemKey) return { ok: false, code: "NO_COMPLETION" };
    const context = index.items.get(completionItemKey);
    const neighbors = context ? getTimerNeighbors(context.sequence, completionItemKey) : null;
    if (!neighbors?.next) return { ok: false, code: "NO_ADJACENT_ITEM" };
    completionItemKey = null;
    return remember(engine.loadItem(neighbors.next));
  }

  function getViewModel() {
    const snapshots = new Map(engine.getSnapshots().map((snapshot) => [snapshot.itemKey, snapshot]));
    const activeSnapshot = engine.getSnapshot();
    const activeContext = activeSnapshot ? index.items.get(activeSnapshot.itemKey) ?? null : null;
    const currentDayContext = dayId ? index.days.get(dayId) ?? null : null;
    const neighborContext = activeSnapshot && activeContext
      ? getTimerNeighbors(activeContext.sequence, activeSnapshot.itemKey)
      : null;
    const completionContext = completionItemKey ? index.items.get(completionItemKey) ?? null : null;
    const completionNeighbors = completionContext
      ? getTimerNeighbors(completionContext.sequence, completionItemKey)
      : null;

    return {
      route,
      breadcrumbs: buildBreadcrumbs(),
      tracks: [...index.tracks.values()].map(({ node }) => node),
      programs: trackId ? [...index.programs.values()].filter((item) => item.track.id === trackId).map((item) => item.node) : [],
      packages: programId ? [...index.packages.values()].filter((item) => item.program.id === programId).map((item) => item.node) : [],
      days: programId ? [...index.days.values()].filter((item) => item.program.id === programId && (!packageId || item.package?.id === packageId)).map((item) => item.node) : [],
      currentDay: currentDayContext ? buildDayView(currentDayContext, snapshots) : null,
      now: activeSnapshot && activeContext ? buildNowView(activeSnapshot, activeContext, neighborContext) : null,
      running: engine.getRunningSnapshot(),
      conflict: conflictItemKey ? { target: buildItemLabel(index.items.get(conflictItemKey)) } : null,
      resetPending,
      completion: completionItemKey && completionContext
        ? {
            current: buildItemLabel(completionContext),
            next: completionNeighbors?.next ? buildItemLabel(index.items.get(completionNeighbors.next.id)) : null,
          }
        : null,
      focusMode,
      soundEnabled,
      scopeResetPending,
    };
  }

  function buildBreadcrumbs() {
    const crumbs = [{ id: "home", label: "المسارات", action: "home" }];
    const track = trackId ? index.tracks.get(trackId) : null;
    const program = programId ? index.programs.get(programId) : null;
    const pkg = packageId ? index.packages.get(packageId) : null;
    const day = dayId ? index.days.get(dayId) : null;
    if (track) crumbs.push({ id: track.node.id, label: track.node.title, action: "track" });
    if (program) crumbs.push({ id: program.node.id, label: program.node.title, action: "program" });
    if (pkg) crumbs.push({ id: pkg.node.id, label: `الحقيبة ${pkg.node.code}`, action: "package" });
    if (day) crumbs.push({ id: day.node.id, label: `اليوم ${arabicOrdinal(day.node.order)}`, action: "day" });
    return crumbs;
  }

  return Object.freeze({
    selectTrack,
    selectProgram,
    selectPackage,
    selectDay,
    goHome,
    goToNow,
    activateItem,
    confirmConflict,
    cancelConflict,
    toggleCurrent,
    addMinute,
    subtractMinute,
    requestReset,
    confirmReset,
    cancelReset,
    selectAdjacent,
    reconcile,
    dismissCompletion,
    setFocusMode,
    setSoundEnabled,
    requestScopeReset,
    cancelScopeReset,
    confirmScopeReset,
    getPersistenceContext,
    restorePersistenceContext,
    openNextFromCompletion,
    getViewModel,
  });

  function ok() {
    return { ok: true };
  }

  function notFound() {
    return { ok: false, code: "NOT_FOUND" };
  }

  function remember(result) {
    if (result?.snapshot) observedTimerStatus = result.snapshot.status;
    return result;
  }
}

function buildModelIndex(model) {
  const tracks = new Map();
  const programs = new Map();
  const packages = new Map();
  const days = new Map();
  const items = new Map();

  for (const track of model.tracks) {
    tracks.set(track.id, { node: track });
    for (const program of track.programs) {
      programs.set(program.id, { node: program, track });
      const packageNodes = program.structure === "packages" ? program.packages : [null];
      if (program.structure === "packages") {
        for (const pkg of program.packages) packages.set(pkg.id, { node: pkg, track, program });
      }
      for (const pkg of packageNodes) {
        const sourceDays = pkg ? pkg.days : program.days;
        const theme = pkg ? pkg.theme : program.theme;
        for (const day of sourceDays) {
          const sequence = buildTimerSequence(day);
          const dayContext = { node: day, track, program, package: pkg, theme, sequence };
          days.set(day.id, dayContext);
          const sessionByItem = new Map();
          for (const session of day.sessions) {
            for (const activity of session.activities) {
              for (const segment of activity.segments) {
                sessionByItem.set(segment.id, { session, activity });
              }
            }
            for (const item of [...session.placedBreaks, ...session.unplacedBreaks]) {
              sessionByItem.set(item.id, { session, activity: null });
            }
          }
          for (const item of day.externalBreaks) sessionByItem.set(item.id, { session: null, activity: null });
          const sequenceKeys = new Set(sequence.map((entry) => entry.item.id));
          for (const [itemKey, relation] of sessionByItem) {
            const item = sequence.find((entry) => entry.item.id === itemKey)?.item
              ?? relation.session?.unplacedBreaks.find((entry) => entry.id === itemKey)
              ?? day.externalBreaks.find((entry) => entry.id === itemKey);
            items.set(itemKey, {
              item,
              ...dayContext,
              session: relation.session,
              activity: relation.activity,
              sequenceMember: sequenceKeys.has(itemKey),
            });
          }
        }
      }
    }
  }
  return { tracks, programs, packages, days, items };
}

function buildDayView(context, snapshots) {
  const { node: day, theme } = context;
  const externalBySession = new Map(day.externalBreaks.map((item) => [item.afterSession, item]));
  return {
    id: day.id,
    title: `اليوم ${arabicOrdinal(day.order)}`,
    canonicalTotalMinutes: day.canonicalTotalMinutes,
    scheduleTotalMinutes: day.scheduleTotalMinutes,
    hasCanonicalMismatch: day.canonicalTotalMinutes !== day.scheduleTotalMinutes,
    theme,
    sessions: day.sessions.map((session) => ({
      id: session.id,
      order: session.order,
      title: session.title,
      color: theme.sessionPalette?.[`session${session.order}`] ?? theme.primary,
      canonicalInstructionalMinutes: session.canonicalInstructionalMinutes,
      activities: session.activities.map((activity) => ({
        ...activity,
        totalMinutes: activity.segments.reduce((sum, segment) => sum + segment.durationMinutes, 0),
        segments: activity.segments.map((segment) => buildTimedItemView(segment, snapshots.get(segment.id))),
        placedBreaks: session.placedBreaks
          .filter((item) => activity.segments.some((segment) => segment.sourceId === item.afterSegmentId))
          .map((item) => buildTimedItemView(item, snapshots.get(item.id))),
      })),
      unplacedBreaks: session.unplacedBreaks.map((item) => ({
        ...item,
        status: "review",
        ...STATUS_META.review,
      })),
      externalBreak: externalBySession.has(session.order)
        ? buildTimedItemView(externalBySession.get(session.order), snapshots.get(externalBySession.get(session.order).id))
        : null,
    })),
  };
}

function buildTimedItemView(item, snapshot) {
  const status = snapshot?.status ?? "pending";
  return {
    ...item,
    status,
    remainingMs: snapshot?.remainingMs ?? item.durationMinutes * 60_000,
    adjustedDurationMs: snapshot?.adjustedDurationMs ?? item.durationMinutes * 60_000,
    ...STATUS_META[status],
    actionLabel: status === "running" ? "إيقاف مؤقت" : status === "paused" ? "استئناف" : status === "completed" ? null : "تشغيل",
  };
}

function buildNowView(snapshot, context, neighbors) {
  const duration = snapshot.adjustedDurationMs || snapshot.originalDurationMs;
  const progress = duration > 0 ? Math.min(100, Math.max(0, ((duration - snapshot.remainingMs) / duration) * 100)) : 100;
  const nextContext = neighbors?.next ? contextForNeighbor(context, neighbors.next) : null;
  return {
    snapshot,
    context: buildItemLabel(context),
    previous: neighbors?.previous ? buildItemLabel(contextForNeighbor(context, neighbors.previous)) : null,
    next: nextContext ? buildItemLabel(nextContext) : null,
    nextRelation: nextContext && context.activity?.officialCode === nextContext.activity?.officialCode
      ? "التالي ضمن النشاط"
      : "التالي",
    progress,
    timeText: formatTime(snapshot.remainingMs),
    statusLabel: STATUS_META[snapshot.status].label,
  };
}

function contextForNeighbor(context, item) {
  const relation = context.node.sessions.flatMap((session) => [
    ...session.activities.flatMap((activity) => activity.segments.map((segment) => ({ segment, session, activity }))),
    ...session.placedBreaks.map((segment) => ({ segment, session, activity: null })),
  ]).find((entry) => entry.segment.id === item.id);
  return { ...context, item, session: relation?.session ?? null, activity: relation?.activity ?? null };
}

function buildItemLabel(context) {
  if (!context) return null;
  const isBreak = context.item.type === "break";
  return {
    itemKey: context.item.id,
    itemType: context.item.type,
    officialCode: isBreak ? "استراحة" : context.activity?.officialCode ?? "",
    activityTitle: isBreak ? "استراحة" : context.activity?.title ?? "",
    segmentTitle: isBreak ? "" : context.item.title,
    sessionTitle: context.session?.title ?? "",
    durationMinutes: context.item.durationMinutes,
    dayId: context.node.id,
    segmentCount: context.activity?.segments.length ?? 0,
    timerEligible: context.item.timerEligible,
    placementStatus: context.item.placementStatus ?? null,
    theme: { primary: context.theme.primary, dark: context.theme.dark },
  };
}

export function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function arabicOrdinal(order) {
  return order === 1 ? "الأول" : order === 2 ? "الثاني" : String(order);
}
