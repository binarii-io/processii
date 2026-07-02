# Contributing to processii

Thanks for your interest in processii!

## How this repository works (mirror phase)

processii is developed inside binarii's private monorepo and **mirrored** to this repository. During this transition phase:

- **Issues**: open them here — they are triaged normally.
- **Pull requests**: welcome, but they are not merged directly. A maintainer imports accepted changes into the monorepo (with your authorship preserved via `Co-authored-by`), and they come back here through the next sync. This limitation goes away once this repository becomes the source of truth (planned once the public API stabilizes — tracked in the README).
- **History**: sync commits may squash internal work; the initial import is squashed on purpose.

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
