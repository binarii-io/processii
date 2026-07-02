/**
 * CSS variable generation from the TS tokens — local (vendored) copy of `ui-kit`
 * (ADR 0006).
 *
 * Bridge between the source of truth (TS) and the embedded stylesheet: `./styles/theme.css` is
 * the shipped static file (default values of the theming contract); `themeCssVarsBlock()`
 * (re)generates its content and lets it be tested to guarantee it does not drift from the tokens.
 */
import { durations, easings, radii, shadows, spacing, typography, zIndex } from './tokens.js';
import { themes, type ThemeColors, type ThemeName } from './themes.js';

const colorVar = (name: string): string => `--color-${name}`;

/** Typed `[key, value:string]` entries of a string-valued token object. */
function stringEntries(obj: Record<string, string>): [string, string][] {
  return Object.entries(obj);
}

/** `--color-*` declaration block for a given theme (without the selector). */
export function themeColorVars(colors: ThemeColors): Record<string, string> {
  return Object.fromEntries(stringEntries(colors).map(([name, value]) => [colorVar(name), value]));
}

/** Non-chromatic variables, shared by all themes. */
export function structuralVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of stringEntries(spacing)) out[`--spacing-${k}`] = v;
  for (const [k, v] of stringEntries(radii)) out[`--radius-${k}`] = v;
  for (const [k, v] of stringEntries(shadows)) out[`--shadow-${k}`] = v;
  for (const [k, v] of stringEntries(zIndex)) out[`--z-${k}`] = v;
  for (const [k, v] of stringEntries(durations)) out[`--duration-${k}`] = v;
  for (const [k, v] of stringEntries(easings)) out[`--ease-${k}`] = v;
  out['--font-sans'] = typography.fontFamily.sans;
  out['--font-mono'] = typography.fontFamily.mono;
  for (const [k, v] of stringEntries(typography.fontSize)) out[`--text-${k}`] = v;
  for (const [k, v] of stringEntries(typography.lineHeight)) out[`--leading-${k}`] = v;
  for (const [k, v] of stringEntries(typography.fontWeight)) out[`--weight-${k}`] = v;
  return out;
}

const renderBlock = (selector: string, vars: Record<string, string>, indent = '  '): string => {
  const body = Object.entries(vars)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
};

/**
 * Expected full content of `styles/theme.css`. The default (light) theme is on `:root`;
 * dark activates via `.dark` or `[data-theme='dark']`. Explicit light via
 * `[data-theme='light']` allows forcing the theme regardless of the system preference.
 */
export function themeCssVarsBlock(): string {
  const lightColors = themeColorVars(themes.light);
  const darkColors = themeColorVars(themes.dark);
  const structural = structuralVars();

  return [
    renderBlock(':root', { ...lightColors, ...structural }),
    renderBlock(":root[data-theme='light']", lightColors),
    // Multi-line selector: the format Prettier emits for `styles/theme.css`,
    // so this block stays an exact subset of the shipped file (see the sync test).
    renderBlock(":root.dark,\n:root[data-theme='dark']", darkColors),
  ].join('\n\n');
}

export const themeNames: readonly ThemeName[] = ['light', 'dark'];
