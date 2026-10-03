// @ts-check

import { migrateStoredState } from "./migration.js";
import { STORAGE_KEY } from "./schema.js";

/** @param {{load(path:string,options?:Record<string,unknown>):Promise<{get(key:string):Promise<any>,set(key:string,value:any):Promise<void>,delete(key:string):Promise<boolean>,save():Promise<void>}>}} storeApi */
export async function createDesktopStorageAdapter(storeApi) {
  const store = await storeApi.load("training-timer-state.json", { autoSave: false });
  let cached = await store.get(STORAGE_KEY);

  function load() {
    if (!cached) return { state: null, code: null };
    return migrateStoredState(cached);
  }

  function save(state) {
    cached = structuredCloneSafe(state);
    void store.set(STORAGE_KEY, cached).then(() => store.save());
    return { ok: true };
  }

  function clear() {
    cached = null;
    void store.delete(STORAGE_KEY).then(() => store.save());
  }

  return Object.freeze({ load, save, clear, key: STORAGE_KEY, kind: "tauri-store" });
}

function structuredCloneSafe(value) {
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}
