/**
 * Tailwind preset — local (vendored) copy of the `ui-kit` preset (ADR 0006).
 *
 * Maps the Tailwind utilities (`bg-surface`, `text-muted`, `rounded-lg`, …) onto the theming
 * contract's CSS variables (same names as ui-kit). A host app outside memorii imports this
 * preset AND `@binarii/processii/styles.css` (default values — or provides its own variables);
 * within memorii, the apps keep the ui-kit preset and stylesheet and do not import the
 * package's (same variables on the same selectors: the import order would decide). Theme
 * switching (light/dark) happens by changing `data-theme`/`.dark` on `:root`, without
 * recompiling. No color value is hard-coded here.
 */
import type { Config } from 'tailwindcss';
import { semanticColorNames } from './tokens.js';

const colorTokens: Record<string, string> = Object.fromEntries(
  semanticColorNames.map((name) => [name, `var(--color-${name})`]),
);

export const preset = {
  darkMode: ['class', "[data-theme='dark']"],
  theme: {
    extend: {
      colors: colorTokens,
      borderColor: {
        DEFAULT: 'var(--color-border)',
      },
      ringColor: {
        DEFAULT: 'var(--color-ring)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      zIndex: {
        dropdown: 'var(--z-dropdown)',
        sticky: 'var(--z-sticky)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        popover: 'var(--z-popover)',
        toast: 'var(--z-toast)',
        tooltip: 'var(--z-tooltip)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
      },
    },
  },
} satisfies Partial<Config>;

export default preset;
