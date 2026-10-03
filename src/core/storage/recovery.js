// @ts-check

import { STORAGE_SCHEMA_VERSION } from "./schema.js";

export function buildPersistentState({ controller, engine, datasetSchemaVersion, savedAt = Date.now() }) {
  const navigation = controller.getPersistenceContext();
  return {
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    datasetSchemaVersion,
    savedAt,
    ...navigation,
    timerSnapshots: engine.getSnapshots().filter(isMeaningfulSnapshot),
  };
}

export function recoverApplicationState({ state, model, engine, controller, now = Date.now(), development = false, logger = console }) {
  if (!state) return { recovered: false, recoveredCompletion: false, restoredSnapshots: 0, ignoredSnapshots: 0 };
  const itemIndex = buildItemIndex(model);
  const valid = [];
  let ignoredSnapshots = 0;

  for (const snapshot of state.timerSnapshots) {
    const item = itemIndex.get(snapshot.itemKey);
    if (!item) {
      ignoredSnapshots += 1;
      if (development) logger.warn(`[training-timer] UNKNOWN_STORED_ITEM: ${snapshot.itemKey}`);
      continue;
    }
    valid.push({ item, snapshot });
  }

  valid.sort((left, right) => Number(left.snapshot.status === "running") - Number(right.snapshot.status === "running"));
  let restoredSnapshots = 0;
  let recoveredCompletion = false;
  for (const entry of valid) {
    const result = engine.loadItem(entry.item, { snapshot: entry.snapshot });
    if (result.ok) {
      restoredSnapshots += 1;
      if (entry.snapshot.status === "running" && result.snapshot.status === "completed") recoveredCompletion = true;
    }
    else {
      ignoredSnapshots += 1;
      if (development) logger.warn(`[training-timer] INVALID_STORED_SNAPSHOT: ${entry.snapshot.itemKey}`);
    }
  }

  const running = engine.getRunningSnapshot();
  if (running) {
    const item = itemIndex.get(running.itemKey);
    if (item) engine.loadItem(item);
    const reconciled = engine.reconcile(now);
    recoveredCompletion = recoveredCompletion || reconciled?.status === "completed";
  }

  if (state.selectedItemKey && itemIndex.has(state.selectedItemKey) && !engine.getRunningSnapshot()) {
    engine.loadItem(itemIndex.get(state.selectedItemKey));
  }
  controller.restorePersistenceContext(state);
  return { recovered: true, recoveredCompletion, restoredSnapshots, ignoredSnapshots };
}

export function isMeaningfulSnapshot(snapshot) {
  return snapshot.status !== "idle" || snapshot.adjustedDurationMs !== snapshot.originalDurationMs;
}

export function buildItemIndex(model) {
  const index = new Map();
  for (const track of model.tracks) {
    for (const program of track.programs) {
      const packages = program.structure === "packages" ? program.packages : [null];
      for (const pkg of packages) {
        const days = pkg ? pkg.days : program.days;
        for (const day of days) {
          for (const session of day.sessions) {
            for (const activity of session.activities) for (const item of activity.segments) index.set(item.id, item);
            for (const item of [...session.placedBreaks, ...session.unplacedBreaks]) index.set(item.id, item);
          }
          for (const item of day.externalBreaks) index.set(item.id, item);
        }
      }
    }
  }
  return index;
}
