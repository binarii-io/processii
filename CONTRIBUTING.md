# Contributing to processii

Thanks for your interest in processii!

## How this repository works

This repository is the **source of truth** for processii (it was initially extracted from binarii's private monorepo — early history is squashed on purpose).

- **Issues**: open them here — they are triaged normally.
- **Pull requests**: welcome and merged here. `main` is protected: changes land through a PR with a green CI (build, lint, typecheck, unit tests, Playwright E2E). A maintainer reviews every PR.
- **Releases**: `@binarii/processii` is versioned with semver (`0.x` while the public API settles) and published to npm through the release workflow.

## Developer Certificate of Origin (DCO)

Contributions require a DCO sign-off. Add `-s` to your commits (`git commit -s`), which appends:

```
Signed-off-by: Your Name <you@example.com>
```

By signing off, you certify the [Developer Certificate of Origin](https://developercertificate.org/).

## Development

```bash
pnpm install
pnpm build            # turbo build (packages first, then apps)
pnpm test             # vitest unit tests
pnpm lint && pnpm typecheck && pnpm format:check
pnpm --filter processii-standalone test:e2e   # Playwright E2E (chromium)
```

### Quality bar

- TypeScript strict, **no unjustified `any`**.
- zod validation at every external boundary.
- Real tests for logic (unit) and user journeys (E2E), including edge and error cases.
- The package core (`packages/processii/src`, outside the React layer) stays DOM-free.
- No hard-coded colors: everything goes through the semantic `--color-*` tokens (see the theming contract in `packages/processii/README.md`).

## Security

Please report vulnerabilities privately via GitHub security advisories rather than public issues.
