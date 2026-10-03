// @ts-check

export function createWebPrintAdapter(windowRef = window) {
  return Object.freeze({
    kind: "web",
    async print() {
      try {
        windowRef.print();
        return { ok: true };
      } catch {
        return { ok: false, code: "PRINT_FAILED" };
      }
    },
  });
}

/** @param {{invoke(command:string,args?:Record<string,unknown>):Promise<unknown>}} core */
export function createDesktopPrintAdapter(core) {
  return Object.freeze({
    kind: "desktop",
    async print() {
      try {
        await core.invoke("print_current_window");
        return { ok: true };
      } catch {
        return { ok: false, code: "PRINT_FAILED" };
      }
    },
  });
}
