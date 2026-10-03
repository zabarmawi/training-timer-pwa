// @ts-check

import {
  createOverlayState,
  OVERLAY_READY_EVENT,
  OVERLAY_EVENT,
  OVERLAY_VISIBILITY_CHANGED_EVENT,
  OVERLAY_VISIBILITY_EVENT,
} from "./overlay-state.js";
import { normalizeOverlaySettings, OVERLAY_SETTINGS_KEY } from "./overlay-settings.js";

/**
 * Desktop-only coordinator. It receives an already-derived AudienceState and never owns a Timer Engine.
 * @param {{getState:()=>Record<string, any>, transport:{emitTo(label:string,event:string,payload:any):Promise<void>,listen(event:string,handler:()=>void):Promise<()=>void>}, window:{show():Promise<void>,hide():Promise<void>,isVisible():Promise<boolean>}, settings:{get(key:string):Promise<any>,set(key:string,value:any):Promise<void>,save():Promise<void>}}} options
 */
export function createDesktopOverlayManager(options) {
  let visible = false;
  let disposed = false;
  const unlisteners = [];

  async function init() {
    const saved = normalizeOverlaySettings(await options.settings.get(OVERLAY_SETTINGS_KEY));
    visible = saved.visible;
    unlisteners.push(await options.transport.listen(OVERLAY_READY_EVENT, () => { publish(); }));
    unlisteners.push(await options.transport.listen(OVERLAY_VISIBILITY_CHANGED_EVENT, (event) => {
      const next = event?.payload?.visible ?? event?.visible;
      if (typeof next === "boolean") visible = next;
    }));
    if (visible) {
      await options.window.show();
      await publish();
    }
    return saved;
  }

  async function publish() {
    if (disposed) return null;
    const state = createOverlayState(options.getState());
    await options.transport.emitTo("timer-overlay", OVERLAY_EVENT, state);
    return state;
  }

  async function show() {
    visible = true;
    await saveVisibility();
    await options.window.show();
    await options.transport.emitTo("timer-overlay", OVERLAY_VISIBILITY_EVENT, { visible: true });
    await publish();
    return { ok: true, visible };
  }

  async function hide() {
    visible = false;
    await saveVisibility();
    await options.transport.emitTo("timer-overlay", OVERLAY_VISIBILITY_EVENT, { visible: false });
    await options.window.hide();
    return { ok: true, visible };
  }

  async function toggle() {
    return visible ? hide() : show();
  }

  async function saveVisibility() {
    const saved = normalizeOverlaySettings(await options.settings.get(OVERLAY_SETTINGS_KEY));
    await options.settings.set(OVERLAY_SETTINGS_KEY, { ...saved, visible });
    await options.settings.save();
  }

  function dispose() {
    disposed = true;
    unlisteners.forEach((unlisten) => unlisten?.());
  }

  return Object.freeze({ init, publish, show, hide, toggle, isVisible: () => visible, dispose });
}
