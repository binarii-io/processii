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
- **This repo is the source of truth** for a published npm package. The public API is **every
  surface of the `exports` map** — main entry, `/ui` subpath, `./styles.css` (token names included)
  and `./tailwind-preset`. Any change to any of them is a semver event, called out in the PR.
- **Never break the persisted Y.Doc format silently** (users' IndexedDB, consumers' databases).
  Additive field changes need no bump; a **breaking layout change** bumps `DOC_SCHEMA_VERSION` and
  ships a migration (a newer build reads older docs; an older build refuses newer ones). See the
  package README § "Document format & compatibility".
- **The core stays DOM-free** (React only in `*.tsx`); **no hard-coded colors** (semantic
  `--color-*` tokens); **no new runtime dependency** in the package without discussion.
- Merges to `main` that touch the build inputs auto-deploy the standalone app (Firebase Hosting,
  gated by the `FIREBASE_DEPLOY_ENABLED` variable) — such a merged PR is live minutes later; treat
  merge as a production action. Docs-only merges do not deploy.
