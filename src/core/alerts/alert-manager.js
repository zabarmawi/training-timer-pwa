// @ts-check

export const ALERT_THRESHOLDS = Object.freeze([
  Object.freeze({ id: "five-minutes", thresholdMs: 5 * 60_000, message: "متبقي 5 دقائق", sound: "five-minutes" }),
  Object.freeze({ id: "one-minute", thresholdMs: 60_000, message: "متبقي دقيقة واحدة", sound: "one-minute" }),
  Object.freeze({ id: "completed", thresholdMs: 0, message: "انتهى الوقت", sound: "completed" }),
]);

/** Independent threshold detector. It observes snapshots but never mutates the Timer Engine. */
export function createAlertManager() {
  let itemKey = null;
  let previousRemainingMs = null;
  const fired = new Set();

  function prime(snapshot) {
    itemKey = snapshot?.itemKey ?? null;
    previousRemainingMs = snapshot ? Math.max(0, Number(snapshot.remainingMs) || 0) : null;
    fired.clear();
    if (snapshot?.status === "completed") ALERT_THRESHOLDS.forEach(({ id }) => fired.add(id));
  }

  function observe(snapshot) {
    if (!snapshot?.itemKey) {
      prime(null);
      return [];
    }
    if (snapshot.itemKey !== itemKey || previousRemainingMs === null) {
      prime(snapshot);
      return [];
    }

    const remainingMs = Math.max(0, Number(snapshot.remainingMs) || 0);
    if (remainingMs > previousRemainingMs) {
      for (const threshold of ALERT_THRESHOLDS) {
        if (remainingMs > threshold.thresholdMs) fired.delete(threshold.id);
      }
    }

    const events = [];
    if (snapshot.status !== "idle") {
      for (const threshold of ALERT_THRESHOLDS) {
        if (!fired.has(threshold.id)
          && previousRemainingMs > threshold.thresholdMs
          && remainingMs <= threshold.thresholdMs) {
          fired.add(threshold.id);
          events.push(Object.freeze({ ...threshold, itemKey: snapshot.itemKey, remainingMs }));
        }
      }
    }
    previousRemainingMs = remainingMs;
    return events;
  }

  return Object.freeze({ prime, observe });
}
