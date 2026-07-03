# AGENTS.md

**Read this first.** It tells any coding agent (and any human) how to work in this repository autonomously without breaking its guarantees.

## What this repository is

The **source of truth** for processii: a CRDT-backed process-whiteboard engine and its standalone P2P app.

- `packages/processii` — the engine + React editing surface, published to npm as [`@binarii/processii`](https://www.npmjs.com/package/@binarii/processii) (semver; `0.x` while the API settles).
- `apps/standalone` — the P2P web app (PWA), continuously deployed to Firebase Hosting from `main`.

Downstream consumers (including the private memorii product) install the npm package and gate version bumps with their own contract tests. **The public API is everything the package `exports` map exposes** — the main entry (`src/index.ts`), the `/ui` subpath (`src/ui/index.ts`), the `./styles.css` sheet (including the `--color-*` token names it defines) and the `./tailwind-preset` module. Treat any change to any of these surfaces as a semver event.

## How to orient yourself

1. Read this file entirely.
2. Read `packages/processii/README.md` — the full API: scene model, CRDT board, engine, rendering, adapters (transport/persistence), theming contract, `/ui` subpath, interop.
3. Read `apps/standalone/README.md` before touching the app (P2P sessions, persistence, AI assistant).
4. `CONTRIBUTING.md` covers the PR process and DCO.

## Hard rules

- **Everything in English** — code, comments, test labels, docs, commits, PR text. (The standalone app's user-facing UI copy is currently French: that is product copy, do not translate it as a side effect.)
- **Never commit to `main`** — it is protected. Branch (`feat/<short>`, `fix/<short>`, `docs/<short>`), open a PR, get a green CI and a review before merge. No force-push.
- **The core stays DOM-free.** Only the React layer (`*.tsx` files) may touch React/DOM. `scene`, `board`, `engine`, `render`, `viewport`, `hit-test`, `handles`, `snap`, `history`, `connector`, `presence`, `crdt`, `adapters` must run headless.
- **Never break the persisted Y.Doc format.** Boards live in users' IndexedDB and in consumers' databases. Until the schema-version mechanism exists (issue #5, required before 1.0), any change to the document layout must be additive and read old documents unchanged.
- **No hard-coded colors.** Everything goes through the semantic `--color-*` tokens (theming contract in the package README).
- **No new runtime dependency** in `packages/processii` without explicit discussion in the PR — the package's self-containment is a feature.
- **No secrets in the tree.** Firebase identifiers live in repository variables/secrets, never in committed files (`.firebaserc` is gitignored on purpose).

## Definition of Done

- [ ] Strict TypeScript, **zero unjustified `any`**; build passes.
- [ ] zod validation at every external boundary.
- [ ] Real tests: unit (Vitest) for logic including edge/error cases; Playwright E2E when a user journey changes; CRDT convergence tests when the shared state model changes.
- [ ] Docs updated in the same PR (package/app README; this file if the working rules change).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm format:check` green.
- [ ] CI green on the PR; review passed.

## Commands

```bash
pnpm install --frozen-lockfile   # install the workspace
pnpm build                        # turbo: package first, then app
pnpm test                         # Vitest (package + app)
pnpm test:e2e                     # Playwright (standalone app)
pnpm lint && pnpm typecheck && pnpm format:check
pnpm --filter processii-standalone dev    # dev server on http://localhost:5174 (strict port)
```

First E2E run on a fresh machine: install the browser once —
`pnpm --filter processii-standalone exec playwright install chromium`.

## Architecture map (where things live)

`packages/processii/src/`:

- `scene.ts` — native scene model (elements, steps, swimlanes, groups) + zod schemas.
- `board.ts` — Yjs CRDT board (convergent add/move/update/remove).
- `engine.ts` — operations, local selection, geometry, render model.
- `render.ts` — Canvas 2D renderer, DOM-free, colors resolved via semantic tokens.
- `viewport.ts`, `hit-test.ts`, `handles.ts`, `snap.ts`, `history.ts`, `connector.ts` — interaction substrate.
- `crdt/` — local Yjs aliases (`CrdtDoc`, `CrdtAwareness`), doc/awareness helpers, **provider interfaces** (transport/persistence) that hosts implement.
- `adapters.ts` — pluggable transport/persistence/identity wiring.
- `ui/` — vendored UI primitives, Tailwind preset, default theme tokens (`styles/theme.css`); exported via the `/ui` subpath.
- `presence.ts` — headless awareness helpers (cursors, selections, identity).
- `editor.tsx`, `board-canvas.tsx`, `toolbar.tsx`, `style-panel.tsx`, `side-panel.tsx`, `presence-avatars.tsx` — the React editing surface (`WhiteboardEditor`).
- `excalidraw.ts`, `drawio.ts` — lossy-but-marked interop.

`apps/standalone/src/` — app chrome (sessions, sidebar, share/join), `crdt/` providers (y-webrtc, y-indexeddb), `ai/` assistant (user-provided API key), e2e specs in `apps/standalone/e2e/`.

## Release & deployment

- **Release to npm**: version-bump PR on `packages/processii` → merge → run the manual `Release (npm)` workflow (`gh workflow run release.yml -f dist-tag=latest`) → tag `vX.Y.Z` on the release commit. `0.x`: breaking changes bump the minor; document them in the PR.
- **Deployment**: automatic — every merge to `main` touching the build inputs redeploys the standalone app to Firebase Hosting (`.github/workflows/deploy.yml`, gated by the `FIREBASE_DEPLOY_ENABLED` repository variable).
