// @ts-check

export const STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_KEY = "training-timer:persistent-state:v1";

export function isSupportedStorageState(value) {
  return Boolean(value && typeof value === "object"
    && value.storageSchemaVersion === STORAGE_SCHEMA_VERSION
    && typeof value.savedAt === "number"
    && Array.isArray(value.timerSnapshots));
}

export function sanitizeStoredState(value) {
  if (!isSupportedStorageState(value)) return null;
  return {
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    datasetSchemaVersion: typeof value.datasetSchemaVersion === "string" ? value.datasetSchemaVersion : "unknown",
    savedAt: value.savedAt,
    route: validRoute(value.route) ? value.route : "tracks",
    trackId: stringOrNull(value.trackId),
    programId: stringOrNull(value.programId),
    packageId: stringOrNull(value.packageId),
    dayId: stringOrNull(value.dayId),
    selectedItemKey: stringOrNull(value.selectedItemKey),
    timerSnapshots: value.timerSnapshots.filter((snapshot) => snapshot && typeof snapshot === "object"),
    focusMode: value.focusMode === true,
    soundEnabled: value.soundEnabled !== false,
  };
}

function validRoute(value) {
  return ["tracks", "programs", "packages", "days", "facilitator"].includes(value);
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}
