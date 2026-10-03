// @ts-check

export function createWebAudienceAdapter(windowRef = window) {
  return Object.freeze({
    kind: "web",
    async open() {
      const audienceWindow = windowRef.open("./audience.html", "training-timer-audience", "popup=yes,width=1280,height=800");
      return audienceWindow ? { ok: true, reused: false } : { ok: false, code: "POPUP_BLOCKED" };
    },
  });
}

/** @param {{getByLabel(label:string):Promise<any>,create(label:string,options:Record<string,unknown>):any}} platform */
export function createDesktopAudienceAdapter(platform) {
  return Object.freeze({
    kind: "desktop",
    async open() {
      const existing = await platform.getByLabel("audience");
      if (existing) {
        await existing.show();
        await existing.unminimize?.();
        return { ok: true, reused: true };
      }
      try {
        const created = platform.create("audience", {
          url: "audience.html",
          title: "شاشة العرض — مؤقت البرنامج المهني لسفراء القيادة",
          width: 1280,
          height: 800,
          minWidth: 640,
          minHeight: 420,
          resizable: true,
        });
        await waitForCreated(created);
        return { ok: true, reused: false };
      } catch {
        return { ok: false, code: "DESKTOP_AUDIENCE_OPEN_FAILED" };
      }
    },
  });
}

function waitForCreated(windowHandle) {
  return new Promise((resolve, reject) => {
    windowHandle.once("tauri://created", resolve);
    windowHandle.once("tauri://error", reject);
  });
}
