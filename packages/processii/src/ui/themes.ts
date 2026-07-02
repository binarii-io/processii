/**
 * Light & dark themes: `SemanticColorName → concrete value` mapping — local (vendored) copy of
 * the `ui-kit` themes (ADR 0006). These are the theming contract's **embedded default values**:
 * outside memorii they feed `./styles/theme.css`; within memorii, ui-kit provides the same
 * variables (same names, same values) and remains the source of the values.
 *
 * Components NEVER read these objects directly: they consume the generated CSS variables
 * (`--color-bg`, …) through the Tailwind classes.
 */
import { palette, type SemanticColorName } from './tokens.js';

export type ThemeName = 'light' | 'dark';

export type ThemeColors = Record<SemanticColorName, string>;

export const lightTheme: ThemeColors = {
  bg: palette.white,
  surface: palette.white,
  'surface-raised': palette.white,
  sidebar: palette.zinc[100], // slightly grayed menu vs white content (`bg`)
  overlay: 'rgb(9 9 11 / 0.45)', // zinc-950 @ 45%
  ink: palette.navy[950], // dark brand band #020530 (light text on top)
  text: palette.zinc[900],
  heading: palette.navy[950], // titles in brand navy #020530 (≈ 19:1 on white)
  muted: palette.zinc[600], // 5.4:1 on white
  border: palette.zinc[200],
  input: palette.zinc[300],
  ring: palette.binarii[600],
  accent: palette.binarii[600], // brand blue #0166ff — white fg @ 4.83:1 (AA)
  'accent-hover': palette.binarii[700],
  'accent-fg': palette.white,
  'accent-subtle': palette.binarii[50],
  danger: palette.red[600], // 5.9:1 on white
  'danger-hover': palette.red[700],
  'danger-fg': palette.white,
  'danger-subtle': palette.red[50],
  success: palette.green[700], // 4.5:1 on white
  'success-fg': palette.white,
  'success-subtle': palette.green[50],
  warning: palette.amber[700], // 4.7:1 on white
  'warning-fg': palette.white,
  'warning-subtle': palette.amber[50],
};

export const darkTheme: ThemeColors = {
  bg: palette.navy[950], // brand navy #020530
  surface: palette.navy[850],
  'surface-raised': palette.navy[800],
  sidebar: palette.navy[850], // menu = navy surface, distinct from the content background (darker `bg`)
  overlay: 'rgb(0 0 0 / 0.6)',
  ink: palette.navy[850], // band slightly lighter than the navy background (stays visible in dark)
  text: palette.zinc[50],
  heading: palette.zinc[50], // in dark, titles = light text (navy is already the background)
  muted: palette.zinc[400], // ≥ 7:1 on the navy backgrounds
  border: palette.navy[700],
  input: palette.navy[600],
  ring: palette.binarii[400],
  accent: palette.binarii[600], // brand blue #0166ff — white fg @ 4.83:1 (AA)
  'accent-hover': palette.binarii[700],
  'accent-fg': palette.white,
  'accent-subtle': palette.binarii[900],
  danger: palette.red[600], // white fg @ 4.83:1 (AA)
  'danger-hover': palette.red[700], // white fg @ 6.47:1 (AA kept on hover)
  'danger-fg': palette.white,
  'danger-subtle': 'rgb(127 29 29 / 0.4)',
  success: palette.green[500], // zinc-950 fg @ 8.73:1 (AA)
  'success-fg': palette.zinc[950],
  'success-subtle': 'rgb(20 83 45 / 0.4)',
  warning: palette.amber[500], // zinc-950 fg @ 9.26:1 (AA)
  'warning-fg': palette.zinc[950],
  'warning-subtle': 'rgb(120 53 15 / 0.4)',
};

export const themes: Record<ThemeName, ThemeColors> = {
  light: lightTheme,
  dark: darkTheme,
};
