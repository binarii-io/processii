# processii

**Process whiteboard engine and collaborative editor** — the open source core of [memorii](https://memorii.binarii.app)'s whiteboard, by [binarii](https://github.com/binarii-io).

processii is a CRDT-backed (Yjs) whiteboard engine specialized for **process boards**: rich step cards, bound connectors, swimlanes, groups and nested sub-processes — with the interaction substrate you expect from a modern whiteboard (zoom/pan viewport, hit-testing, marquee selection, resize/rotate handles, snapping, undo/redo, live presence cursors).

## Packages

| Directory                                  | What it is                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/processii`](packages/processii) | `@binarii/processii` — the engine (scene model, Yjs CRDT board, Canvas 2D renderer, interop) **and** the shared React editing surface (`WhiteboardEditor`, toolbar, style/side panels, presence). DOM-free core; React layer with React as a peer dependency. |
| [`apps/standalone`](apps/standalone)       | The standalone P2P web app (PWA): offline-first via IndexedDB, optional peer-to-peer collaboration via WebRTC, no account and no backend. Doubles as the reference integration.                                                                               |

## Key properties

- **Offline-first, local-first.** All shared state lives in a Yjs document. No network required; sync is pluggable.
- **Pluggable transport & persistence.** The engine never opens a connection: hosts inject providers (WebSocket sync, WebRTC P2P, IndexedDB, in-memory for tests) behind small typed interfaces.
- **Themable by CSS variables.** Rendering and UI resolve semantic color tokens (`--color-*`) at runtime. Import the bundled `@binarii/processii/styles.css` defaults, or provide your own variables.
- **Interop.** Lossy-but-marked import/export to Excalidraw and draw.io.
- **Strictly typed.** TypeScript strict, no `any`, zod validation at the boundaries.

## Quickstart

```bash
pnpm install
pnpm build          # build the workspace (turbo)
pnpm test           # unit tests (vitest)
pnpm --filter processii-standalone dev   # run the standalone app locally
```

Embedding the editor:

```tsx
import { createEngine, WhiteboardEditor, useWhiteboardEngine } from '@binarii/processii';
import '@binarii/processii/styles.css'; // or provide your own --color-* variables

function MyBoard({ doc }) {
  const engine = useWhiteboardEngine(doc); // doc: Y.Doc
  return engine ? <WhiteboardEditor engine={engine} /> : null;
}
```

See [`packages/processii/README.md`](packages/processii/README.md) for the full API (scene model, adapters, theming contract, interop).

## Status & governance

processii is extracted from the memorii monorepo and is currently **mirrored** from it: the private monorepo is the source of truth during the transition, and changes land here through a sync pipeline. External issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how they are integrated while the mirror is in place.

- License: [Apache-2.0](LICENSE)
- npm: `@binarii/processii` (publication planned; not yet on the registry)
