/**
 * Tests for the vendored theme runtime helpers (ADR 0006, #95) — adapted from `ui-kit`:
 * the theming contract (`data-theme` + `.dark` on the root element) must behave identically.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, getAppliedTheme, getSystemTheme, THEME_ATTRIBUTE } from './theme.js';

describe('ui/theme runtime', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.documentElement.classList.remove('dark');
  });

  it("applyTheme('dark') sets data-theme and the .dark class on the root", () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it("applyTheme('light') removes the .dark class (actual toggle)", () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applyTheme targets an explicit root when provided', () => {
    const el = document.createElement('div');
    applyTheme('dark', el);
    expect(el.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBeNull();
  });

  it('getAppliedTheme reads the current theme back, null when absent/invalid', () => {
    expect(getAppliedTheme()).toBeNull();
    applyTheme('dark');
    expect(getAppliedTheme()).toBe('dark');
    document.documentElement.setAttribute(THEME_ATTRIBUTE, 'bogus');
    expect(getAppliedTheme()).toBeNull();
  });

  it('getSystemTheme falls back to light when matchMedia does not match', () => {
    expect(getSystemTheme()).toBe('light');
  });
});
