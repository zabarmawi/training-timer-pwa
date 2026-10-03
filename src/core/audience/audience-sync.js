// @ts-check

import { isAudienceState } from "./audience-state.js";

export const AUDIENCE_CHANNEL = "training-timer:audience:v1";
export const AUDIENCE_STORAGE_EVENT_KEY = "training-timer:audience-event:v1";
export const MESSAGE_TYPES = Object.freeze({
  ready: "AUDIENCE_READY",
  request: "STATE_REQUEST",
  sync: "STATE_SYNC",
  ping: "PING",
  pong: "PONG",
});

/** @param {{getState: () => import('./types.js').AudienceState, windowRef?: Window, BroadcastChannelClass?: typeof BroadcastChannel | null, storage?: Storage | null, clock?: {now(): number}}} options */
export function createFacilitatorAudienceSync(options) {
  const windowRef = options.windowRef ?? window;
  const Channel = options.BroadcastChannelClass === undefined ? globalThis.BroadcastChannel : options.BroadcastChannelClass;
  const clock = options.clock ?? { now: () => Date.now() };
  const origin = windowRef.location?.origin ?? "";
  const targetOrigin = origin && origin !== "null" ? origin : "*";
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  let audienceWindow = null;
  let lastSeenAt = null;
  let opened = false;
  let channel = null;
  let disposed = false;
  let lastPingAt = 0;
  let connectionLost = false;

  if (Channel) {
    channel = new Channel(AUDIENCE_CHANNEL);
    channel.addEventListener("message", (event) => receive(event.data));
  } else {
    windowRef.addEventListener?.("message", receiveWindowMessage);
    windowRef.addEventListener?.("storage", receiveStorageEvent);
  }

  function receiveWindowMessage(event) {
    if (origin && event.origin && event.origin !== origin) return;
    receive(event.data);
  }

  function receiveStorageEvent(event) {
    if (event.key !== AUDIENCE_STORAGE_EVENT_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue).message); } catch { /* Ignore malformed transport events. */ }
  }

  function receive(message) {
    if (!message || typeof message !== "object") return;
    if ([MESSAGE_TYPES.ready, MESSAGE_TYPES.request].includes(message.type)) {
      connectionLost = false;
      lastSeenAt = clock.now();
      publish();
    }
    if (message.type === MESSAGE_TYPES.pong) {
      connectionLost = false;
      lastSeenAt = clock.now();
    }
  }

  function send(message) {
    if (disposed) return;
    if (channel) channel.postMessage(message);
    else if (audienceWindow && !audienceWindow.closed) audienceWindow.postMessage(message, targetOrigin);
    else sendStorageEvent(storage, message, clock.now());
  }

  function publish() {
    const state = options.getState();
    send({ type: MESSAGE_TYPES.sync, state });
    return state;
  }

  function openDisplay(url = "./audience.html") {
    const before = options.getState();
    audienceWindow = windowRef.open(url, "training-timer-audience", "popup=yes,width=1280,height=800");
    opened = Boolean(audienceWindow);
    connectionLost = false;
    const after = options.getState();
    return { ok: opened, timerUnchanged: sameTimerState(before, after) };
  }

  function heartbeat() {
    if (audienceWindow?.closed) {
      audienceWindow = null;
      lastSeenAt = null;
      connectionLost = true;
      return getConnection();
    }
    const now = clock.now();
    if ((opened || lastSeenAt !== null) && now - lastPingAt >= 2_000) {
      lastPingAt = now;
      send({ type: MESSAGE_TYPES.ping, sentAt: now });
    }
    return getConnection();
  }

  function getConnection() {
    if (connectionLost) return { status: "lost", label: "فقد الاتصال" };
    if (!opened && lastSeenAt === null) return { status: "not-opened", label: "غير مفتوحة" };
    if (audienceWindow?.closed) return { status: "lost", label: "فقد الاتصال" };
    if (lastSeenAt !== null && clock.now() - lastSeenAt <= 6_000) return { status: "connected", label: "متصلة" };
    return { status: opened ? "connecting" : "lost", label: opened ? "جارٍ الاتصال" : "فقد الاتصال" };
  }

  function dispose() {
    disposed = true;
    channel?.close();
    windowRef.removeEventListener?.("message", receiveWindowMessage);
    windowRef.removeEventListener?.("storage", receiveStorageEvent);
  }

  return Object.freeze({ openDisplay, publish, heartbeat, getConnection, dispose });
}

/** @param {{onState: (state: import('./types.js').AudienceState) => void, windowRef?: Window, BroadcastChannelClass?: typeof BroadcastChannel | null, storage?: Storage | null, clock?: {now(): number}}} options */
export function createAudienceReceiver(options) {
  const windowRef = options.windowRef ?? window;
  const Channel = options.BroadcastChannelClass === undefined ? globalThis.BroadcastChannel : options.BroadcastChannelClass;
  const clock = options.clock ?? { now: () => Date.now() };
  const origin = windowRef.location?.origin ?? "";
  const targetOrigin = origin && origin !== "null" ? origin : "*";
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  let channel = null;

  if (Channel) {
    channel = new Channel(AUDIENCE_CHANNEL);
    channel.addEventListener("message", (event) => receive(event.data));
  } else {
    windowRef.addEventListener?.("message", receiveWindowMessage);
    windowRef.addEventListener?.("storage", receiveStorageEvent);
  }

  function receiveWindowMessage(event) {
    if (origin && event.origin && event.origin !== origin) return;
    receive(event.data);
  }

  function receiveStorageEvent(event) {
    if (event.key !== AUDIENCE_STORAGE_EVENT_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue).message); } catch { /* Ignore malformed transport events. */ }
  }

  function receive(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === MESSAGE_TYPES.sync && isAudienceState(message.state)) options.onState(message.state);
    if (message.type === MESSAGE_TYPES.ping) send({ type: MESSAGE_TYPES.pong, sentAt: clock.now() });
  }

  function send(message) {
    if (channel) channel.postMessage(message);
    else if (windowRef.opener && !windowRef.opener.closed) windowRef.opener.postMessage(message, targetOrigin);
    else sendStorageEvent(storage, message, clock.now());
  }

  function announceReady() {
    send({ type: MESSAGE_TYPES.ready, sentAt: clock.now() });
    send({ type: MESSAGE_TYPES.request, sentAt: clock.now() });
  }

  function dispose() {
    channel?.close();
    windowRef.removeEventListener?.("message", receiveWindowMessage);
    windowRef.removeEventListener?.("storage", receiveStorageEvent);
  }

  announceReady();
  return Object.freeze({ dispose, requestState: announceReady });
}

function sendStorageEvent(storage, message, nonce) {
  if (!storage) return;
  try {
    storage.setItem(AUDIENCE_STORAGE_EVENT_KEY, JSON.stringify({ nonce, message }));
    storage.removeItem(AUDIENCE_STORAGE_EVENT_KEY);
  } catch { /* Synchronization fallback must never break the timer. */ }
}

function sameTimerState(before, after) {
  return before.itemKey === after.itemKey && before.status === after.status
    && before.remainingMs === after.remainingMs && before.endAt === after.endAt;
}
