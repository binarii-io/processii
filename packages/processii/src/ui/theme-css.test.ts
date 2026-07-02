/**
 * Sync of the vendored theming contract (ADR 0006): the static `styles/theme.css` sheet
 * (embedded default values) must never drift from the TS tokens, and each semantic color
 * must produce its `--color-<name>` CSS variable (same names as `ui-kit`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { themeCssVarsBlock, themeColorVars } from './theme-css.js';
import { semanticColorNames } from './tokens.js';
import { lightTheme, darkTheme } from './themes.js';

const here = dirname(fileURLToPath(import.meta.url));
const themeCssPath = join(here, 'styles', 'theme.css');

describe('ui/theme.css (tokens ↔ embedded CSS sync)', () => {
  it('the shipped file contains the variable block generated from the tokens', () => {
    const css = readFileSync(themeCssPath, 'utf8');
    // If this test fails: regenerate styles/theme.css from themeCssVarsBlock().
    expect(css).toContain(themeCssVarsBlock());
  });

  it('does NOT contain Tailwind directives (the host app keeps its own entry)', () => {
    const css = readFileSync(themeCssPath, 'utf8');
    expect(css).not.toContain('@tailwind');
  });

  it('themeColorVars produces a --color-* variable per semantic color', () => {
    const vars = themeColorVars(lightTheme);
    for (const name of semanticColorNames) {
      expect(vars[`--color-${name}`]).toBe(lightTheme[name]);
    }
  });

  it('the block declares a distinct dark selector with the dark values', () => {
    const block = themeCssVarsBlock();
    expect(block).toContain("[data-theme='dark']");
    expect(block).toContain(`--color-bg: ${darkTheme.bg};`);
    expect(block).toContain(`--color-bg: ${lightTheme.bg};`);
  });
});
