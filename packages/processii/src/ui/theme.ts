import type { ThemeName } from './themes.js';

/**
 * Client-side theme switching runtime helpers — local copy vendored from `ui-kit`
 * (ADR 0006, #95).
 *
 * The theme is driven by the `data-theme` attribute (and the `.dark` class) on the root
 * element (`<html>`) — that is the theming contract shared with ui-kit. No persistence
 * logic here (pure presentation): the host app decides where to store the preference.
 * `applyTheme` only mutates the root DOM element.
 */

export const THEME_ATTRIBUTE = 'data-theme';

/** Applies a theme on the provided root element (default: `document.documentElement`). */
export function applyTheme(theme: ThemeName, root?: HTMLElement): void {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!el) return;
  el.setAttribute(THEME_ATTRIBUTE, theme);
  el.classList.toggle('dark', theme === 'dark');
}

/** Reads the theme currently declared on the root element, otherwise `null`. */
export function getAppliedTheme(root?: HTMLElement): ThemeName | null {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  const value = el?.getAttribute(THEME_ATTRIBUTE);
  return value === 'light' || value === 'dark' ? value : null;
}

/** System preference (dark/light) via `prefers-color-scheme`. Defaults to `light`. */
export function getSystemTheme(): ThemeName {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
