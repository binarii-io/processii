/**
 * `@binarii/processii/ui` — UI primitives vendored from `ui-kit` (ADR 0006).
 *
 * UI sub-module of the package: accessible primitives (Radix + Tailwind), tokens/themes of the
 * **theming contract** (CSS variables with the same names as ui-kit) and Tailwind preset. Consumed:
 *  - internally by the package's editing surface (toolbar, panels);
 *  - by the standalone app and any external consumer via the `@binarii/processii/ui` subpath.
 *
 * Within memorii, the apps keep using `ui-kit` for their chrome: these copies carry the SAME
 * classes/tokens, the rendering is identical (the ui-kit CSS variables apply).
 */

// Tokens & themes (theming contract — same CSS variable names as ui-kit)
export * from './tokens.js';
export * from './themes.js';
export { themeColorVars, structuralVars, themeCssVarsBlock, themeNames } from './theme-css.js';

// Utilities
export { cn } from './cn.js';
export { applyTheme, getAppliedTheme, getSystemTheme, THEME_ATTRIBUTE } from './theme.js';

// Tailwind preset (maps the utilities onto the contract's CSS variables)
export { preset as tailwindPreset } from './tailwind-preset.js';

// Icons — single library (Lucide). Re-export of the generic types.
export { type LucideIcon, type LucideProps } from 'lucide-react';

// Primitives
export * from './button.js';
export * from './icon-button.js';
export * from './input.js';
export * from './textarea.js';
export * from './switch.js';
export * from './tooltip.js';
export * from './popover.js';
export * from './modal.js';
export * from './app-shell.js';
