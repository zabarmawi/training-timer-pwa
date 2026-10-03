// @ts-check

import { migrateStoredState } from "./migration.js";
import { STORAGE_KEY } from "./schema.js";

/** @param {{storage?: Storage, key?: string, development?: boolean, logger?: Pick<Console, 'warn'>}} [options] */
export function createStorageAdapter(options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const key = options.key ?? STORAGE_KEY;
  const development = options.development ?? false;
  const logger = options.logger ?? console;

  function load() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return { state: null, code: null };
      const migrated = migrateStoredState(JSON.parse(raw));
      if (migrated.code) warn(migrated.code);
      return migrated;
    } catch {
      warn("CORRUPTED_STORAGE_JSON");
      return { state: null, code: "CORRUPTED_STORAGE_JSON" };
    }
  }

  function save(state) {
    try {
      storage.setItem(key, JSON.stringify(state));
      return { ok: true };
    } catch {
      warn("STORAGE_WRITE_FAILED");
      return { ok: false, code: "STORAGE_WRITE_FAILED" };
    }
  }

  function clear() {
    try { storage.removeItem(key); } catch { warn("STORAGE_CLEAR_FAILED"); }
  }

  function warn(code) {
    if (development) logger.warn(`[training-timer] ${code}`);
  }

  return Object.freeze({ load, save, clear, key });
}

/** @param {{adapter: ReturnType<typeof createStorageAdapter>, getState: () => unknown, debounceMs?: number, scheduler?: {set(fn:()=>void, ms:number): unknown, clear(id:unknown):void}}} options */
export function createPersistenceManager(options) {
  const scheduler = options.scheduler ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (id)),
  };
  let pending = null;
  let writes = 0;

  function schedule() {
    if (pending !== null) scheduler.clear(pending);
    pending = scheduler.set(flush, options.debounceMs ?? 180);
  }

  function flush() {
    if (pending !== null) scheduler.clear(pending);
    pending = null;
    const result = options.adapter.save(options.getState());
    if (result.ok) writes += 1;
    return result;
  }

  return Object.freeze({ schedule, flush, getWriteCount: () => writes });
}
