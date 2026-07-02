/**
 * Width of the **docked AI module**, persisted in `localStorage` and clamped. Enables resizing
 * the pane (handle on the left edge) and **restoring its width** after a reload.
 */
const KEY = 'memorii.whiteboard.ai.width';

export const MIN_PANEL_WIDTH = 300;
export const MAX_PANEL_WIDTH = 640;
export const DEFAULT_PANEL_WIDTH = 360;

/** Clamps a width within [MIN, MAX]; falls back to the default when invalid. */
export function clampPanelWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_PANEL_WIDTH;
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(px)));
}

/** Remembered width (clamped), or the default. */
export function loadPanelWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_PANEL_WIDTH;
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

/** Remembers the width (clamped). */
export function savePanelWidth(px: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, String(clampPanelWidth(px)));
  } catch {
    /* no-op */
  }
}
