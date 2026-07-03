# CLAUDE.md

> Loaded **automatically** by Claude Code (unlike `AGENTS.md`, which other agents read). This file
> **imports `AGENTS.md`** below so that **every agent — Claude or not — starts from the same
> rules**. Keep this file short: it is always in context.

@AGENTS.md

## Hard rules (recap — details in AGENTS.md)

- **Everything in English** (code, comments, tests, docs, commits, PRs). The standalone app's
  French UI copy is product copy — leave it alone.
- **Never commit to `main`** (protected). Branch → PR → **green CI + review** → merge. No
  force-push, no bypass.
- **This repo is the source of truth** for a published npm package: `packages/processii/src/index.ts`
  is the public API — any change to it is a semver event, called out explicitly in the PR.
- **Never break the persisted Y.Doc format** (users' IndexedDB, consumers' databases). Additive
  changes only until the schema-version mechanism lands (issue #5, before 1.0).
- **The core stays DOM-free** (React only in `*.tsx`); **no hard-coded colors** (semantic
  `--color-*` tokens); **no new runtime dependency** in the package without discussion.
- Merges to `main` auto-deploy the standalone app (Firebase Hosting) — a merged PR is live minutes
  later; treat merge as a production action.
