// @ts-check

export const OVERLAY_SETTINGS_KEY = "training-timer:overlay-settings:v1";
export const DEFAULT_OVERLAY_SETTINGS = Object.freeze({
  version: 1,
  x: null,
  y: null,
  width: 360,
  height: 190,
  monitorId: null,
  overlayMode: "compact",
  opacity: 0.7,
  locked: false,
  visible: false,
});

export const OVERLAY_MINIMUM_SIZES = Object.freeze({
  minimal: Object.freeze({ width: 180, height: 90 }),
  compact: Object.freeze({ width: 300, height: 170 }),
  detailed: Object.freeze({ width: 360, height: 190 }),
});

export function getOverlayMinimumSize(mode) {
  return OVERLAY_MINIMUM_SIZES[mode] ?? OVERLAY_MINIMUM_SIZES.compact;
}

export function normalizeOverlaySettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const overlayMode = ["minimal", "compact", "detailed"].includes(source.overlayMode) ? source.overlayMode : "compact";
  const minimum = getOverlayMinimumSize(overlayMode);
  return {
    version: 1,
    x: finiteOrNull(source.x),
    y: finiteOrNull(source.y),
    width: clamp(Number(source.width) || 360, minimum.width, 1600),
    height: clamp(Number(source.height) || 190, minimum.height, 1200),
    monitorId: typeof source.monitorId === "string" ? source.monitorId : null,
    overlayMode,
    opacity: [0.5, 0.7, 1].includes(Number(source.opacity)) ? Number(source.opacity) : 0.7,
    locked: source.locked === true,
    visible: source.visible === true,
  };
}

// Settings use physical pixels; keep the layout's logical minimum readable
// on Windows displays that use scaling (for example, 200%).
export function fitWindowsOverlayToScale(settings, scaleFactor) {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const minimum = settings.overlayMode === "minimal"
    ? getOverlayMinimumSize("minimal")
    : DEFAULT_OVERLAY_SETTINGS;
  return normalizeOverlaySettings({
    ...settings,
    width: Math.max(settings.width, minimum.width * scale),
    height: Math.max(settings.height, minimum.height * scale),
  });
}

/**
 * Keeps a saved physical window rectangle inside a currently available monitor.
 * @param {ReturnType<typeof normalizeOverlaySettings>} settings
 * @param {Array<{name?:string|null, position:{x:number,y:number}, size:{width:number,height:number}, isPrimary?:boolean}>} monitors
 */
export function clampOverlayPlacement(settings, monitors) {
  if (!monitors.length) return settings;
  const rect = { x: settings.x, y: settings.y, width: settings.width, height: settings.height };
  const visibleMonitor = rect.x !== null && rect.y !== null
    ? monitors.find((monitor) => intersects(rect, monitorRect(monitor)))
    : null;
  const target = visibleMonitor
    ?? monitors.find((monitor) => monitor.name && monitor.name === settings.monitorId)
    ?? monitors.find((monitor) => monitor.isPrimary)
    ?? monitors[0];
  const bounds = monitorRect(target);
  const margin = 16;
  const width = Math.min(settings.width, Math.max(180, bounds.width - margin * 2));
  const height = Math.min(settings.height, Math.max(90, bounds.height - margin * 2));
  const fallbackX = bounds.x + Math.max(margin, bounds.width - width - 32);
  const fallbackY = bounds.y + 32;
  const x = clamp(rect.x ?? fallbackX, bounds.x + margin, bounds.x + bounds.width - width - margin);
  const y = clamp(rect.y ?? fallbackY, bounds.y + margin, bounds.y + bounds.height - height - margin);
  return { ...settings, x, y, width, height, monitorId: target.name ?? settings.monitorId };
}

function monitorRect(monitor) {
  return { x: monitor.position.x, y: monitor.position.y, width: monitor.size.width, height: monitor.size.height };
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(min, value), Math.max(min, max));
}
