import { STORAGE_SCHEMA_VERSION, sanitizeStoredState } from "./schema.js";

export function migrateStoredState(value) {
  if (!value || typeof value !== "object") return { state: null, code: "INVALID_STORAGE_STATE" };
  if (value.storageSchemaVersion !== STORAGE_SCHEMA_VERSION) {
    return { state: null, code: "UNSUPPORTED_STORAGE_VERSION" };
  }
  const state = sanitizeStoredState(value);
  return state ? { state, code: null } : { state: null, code: "INVALID_STORAGE_STATE" };
}
