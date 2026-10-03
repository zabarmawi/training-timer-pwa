// @ts-check

/**
 * Minimal adapter for the Tauri store plugin.
 *
 * Plugin APIs are not exposed on window.__TAURI__ by withGlobalTauri. The
 * plugin is instead reached through the stable core.invoke bridge.
 *
 * @param {{invoke(command:string,args?:Record<string,unknown>):Promise<any>}} core
 */
export function createTauriStoreApi(core) {
  if (!core?.invoke) throw new Error("TAURI_STORE_UNAVAILABLE");

  return Object.freeze({
    async load(path, options = {}) {
      const rid = await core.invoke("plugin:store|load", { path, options });
      return createStoreHandle(core, rid);
    },
  });
}

function createStoreHandle(core, rid) {
  return Object.freeze({
    async get(key) {
      const [value, exists] = await core.invoke("plugin:store|get", { rid, key });
      return exists ? value : undefined;
    },
    async set(key, value) {
      await core.invoke("plugin:store|set", { rid, key, value });
    },
    async delete(key) {
      return core.invoke("plugin:store|delete", { rid, key });
    },
    async save() {
      await core.invoke("plugin:store|save", { rid });
    },
  });
}
