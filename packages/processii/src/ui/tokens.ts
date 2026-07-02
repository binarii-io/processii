/**
 * Design tokens — local (vendored) copy of the `ui-kit` tokens (ADR 0006).
 *
 * **Theming contract**: the semantic color names (hence the `--color-<name>` CSS variables)
 * are **identical** to ui-kit's. Operational rule: within memorii, the apps load the ui-kit
 * stylesheet and do NOT import `./styles/theme.css` (same variables on the same selectors — if
 * both were loaded, the import order would decide); outside memorii, the host imports the
 * embedded defaults (`./styles/theme.css`, generated from `./themes.ts`) or provides its own
 * variables. Components refer ONLY to semantic names (`bg`, `surface`, `text`, `accent`…),
 * never a raw value.
 */

/** Raw palette scale (zinc + binarii blue + navy). Do not consume directly in a component. */
export const palette = {
  white: '#ffffff',
  black: '#000000',
  zinc: {
    50: '#fafafa',
    100: '#f4f4f5',
    200: '#e4e4e7',
    300: '#d4d4d8',
    400: '#a1a1aa',
    500: '#71717a',
    600: '#52525b',
    700: '#3f3f46',
    800: '#27272a',
    900: '#18181b',
    950: '#09090b',
  },
  /**
   * **binarii brand blue** (`#0166ff`). Primary accent (buttons, links, focus,
   * highlights). Scale derived around 600 = exact brand color.
   */
  binarii: {
    50: '#e6efff',
    100: '#cce0ff',
    200: '#99c1ff',
    300: '#66a3ff',
    400: '#3384ff',
    500: '#1a76ff',
    600: '#0166ff', // exact brand-guideline color
    700: '#0152cc',
    800: '#013d99',
    900: '#012966',
  },
  /**
   * **binarii brand navy** (`#020530`). Base of the **dark** theme (backgrounds/surfaces);
   * lighter shades derived for raised surfaces, borders and fields.
   */
  navy: {
    950: '#020530', // exact brand navy (darkest background)
    900: '#070b34',
    850: '#0a0e3a',
    800: '#161b4d',
    700: '#232a5e',
    600: '#2f3670',
  },
  red: {
    50: '#fef2f2',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
  },
  green: {
    50: '#f0fdf4',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
  },
  amber: {
    50: '#fffbeb',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
  },
} as const;

/**
 * List of the semantic colors. Each entry becomes a `--color-<name>` CSS variable and a
 * `colors.<name>` Tailwind key. This is the components' only color vocabulary —
 * **same names as `ui-kit`** (theming contract, ADR 0006).
 */
export const semanticColorNames = [
  'bg', // page background
  'surface', // cards / panels laid on the background
  'surface-raised', // higher elevation (menus, popovers, dialogs)
  'sidebar', // sidebar background — slightly grayer than `bg` (content) in both themes
  'overlay', // modal veil
  'ink', // dark brand band (binarii navy) — "premium" sections in light as in dark
  'text', // primary text
  'heading', // titles / display — binarii brand navy in light (vs more neutral body text)
  'muted', // secondary / dimmed text
  'border', // borders and separators
  'input', // input field border
  'ring', // focus ring
  'accent', // brand color (binarii blue #0166ff) — action backgrounds
  'accent-hover', // accent on hover
  'accent-fg', // text on accent background
  'accent-subtle', // subtle accent tint (badges, soft backgrounds)
  'danger',
  'danger-hover',
  'danger-fg',
  'danger-subtle',
  'success',
  'success-fg',
  'success-subtle',
  'warning',
  'warning-fg',
  'warning-subtle',
] as const;

export type SemanticColorName = (typeof semanticColorNames)[number];

/** 4px-based spacing scale (key = step, value = rem). */
export const spacing = {
  0: '0px',
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem', // 4px
  2: '0.5rem', // 8px
  3: '0.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  8: '2rem', // 32px
  10: '2.5rem', // 40px
  11: '2.75rem', // 44px — minimum touch target (a11y AA)
  12: '3rem', // 48px
  16: '4rem', // 64px
} as const;

/** Border radii. */
export const radii = {
  none: '0px',
  sm: '0.25rem', // 4px
  md: '0.375rem', // 6px
  lg: '0.5rem', // 8px
  xl: '0.75rem', // 12px
  full: '9999px',
} as const;

/** Shadows (elevation). */
export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
} as const;

/** Typography: families, sizes, line-heights, weights. */
export const typography = {
  fontFamily: {
    // Inter first, modern system fallback. Variable-driven for overrides.
    sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace",
  },
  fontSize: {
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px — default density
    base: '1rem', // 16px
    lg: '1.125rem', // 18px
    xl: '1.25rem', // 20px
    '2xl': '1.5rem', // 24px
  },
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.625',
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

/** Z-index scale (consistent layers). */
export const zIndex = {
  base: '0',
  dropdown: '1000',
  sticky: '1100',
  overlay: '1200',
  modal: '1300',
  popover: '1400',
  toast: '1500',
  tooltip: '1600',
} as const;

/** Animation durations. */
export const durations = {
  fast: '120ms',
  normal: '200ms',
  slow: '320ms',
} as const;

/** Default easing curve. */
export const easings = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/** Default icon size (Lucide), token-driven. */
export const iconSizes = {
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
} as const;
