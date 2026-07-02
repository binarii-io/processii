import { useCallback, useEffect, useState } from 'react';
import { applyTheme, getSystemTheme, type ThemeName } from '@binarii/processii/ui';

const STORAGE_KEY = 'memorii.whiteboard.theme';

/** Reads the persisted preference, otherwise the system theme (`docs/08`: toggling via `data-theme`). */
export function readInitialTheme(): ThemeName {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  }
  return getSystemTheme();
}

/**
 * Light/dark theme hook. Toggling applies the theme on `<html>` via the runtime helper vendored
 * in `@binarii/processii/ui` and **persists** the choice (localStorage). No hard-coded color:
 * only the CSS variables change.
 */
export function useTheme(): { theme: ThemeName; toggle: () => void } {
  const [theme, setTheme] = useState<ThemeName>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
