import preset from '@binarii/processii/tailwind-preset';

/**
 * Tailwind config of the standalone site: consumes the **preset** vendored in
 * `@binarii/processii` (semantic tokens as CSS variables — ADR 0006 theming contract).
 * No hard-coded color — everything goes through the tokens (`docs/08`). We scan the app
 * code AND the compiled components of `@binarii/processii` (the editing surface and the
 * vendored UI primitives live in the package) so their classes are not purged. The package
 * glob covers both layouts — `packages/whiteboard` (memorii monorepo) and `packages/processii`
 * (public mirror, ADR 0006) — so this file mirrors verbatim without a rewrite step.
 */
/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/{whiteboard,processii}/dist/**/*.{js,jsx}',
  ],
};
