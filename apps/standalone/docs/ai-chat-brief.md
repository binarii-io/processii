# Adapted brief — Mistral AI chat live-editing the board (standalone)

> Version of the generic brief **mapped onto the repo**. Source of truth for the implementation in
> `processii-standalone`. See also: `whiteboard-shared-ui` (skill), ADR 0005, AGENTS.md.

## Architecture decision (repo-specific)

- **The chat lives in `apps/whiteboard-standalone/src/` (app-specific chrome), NOT in the shared
  `@binarii/processii` package.** Rationale: the feature is standalone-only for now; the web app
  is not impacted; "one agent = one package" is respected; and the engine already exposes
  everything needed through its **public interface** (`src/index.ts`). If the chat is later
  wanted on the web side too, the "tools/dispatcher/loop" layer (DOM-free) will be promoted into
  the package — but **not in v1**.
- **All mutations go through `space.active.engine`** (a `WhiteboardEngine` instance), i.e. the
  **same path as the manual UI**. That is exactly the "existing state layer" required by the
  brief. No DOM manipulation. Mutations are **Yjs transactions** → the UI re-renders via the
  `onChange`/`engine.observe` already wired in `app.tsx`.

## The board is a **process model**, not a generic graph

This is the most important adaptation. The actual model (`packages/whiteboard/src/scene.ts`):

- Rich node = **`step`** (the step card): `{ kind:'step', id, x, y, width, height, name, description,
showDescription?, skills:string[], deliverables:string[], emotion?:'happy'|'neutral'|'sad',
swimlaneId?, shadow? }`. Default UI dimensions: **200 × 120**.
- Basic shapes: `rectangle` | `ellipse` (with `text?`), `text` (sticky), `line` | `arrow`.
- **Connectors** = `arrow`/`line` elements with `start`/`end` = ids of the linked boxes,
  automatic orthogonal routing. Created via `engine.connect(...)`, **not** via `addElement`.
- **Swimlanes**: process lanes (`engine.addSwimlane/listSwimlanes/...`), with `name`, `order`,
  `color`, `height`. A `step` can be attached via `swimlaneId`.

→ The tools exposed to the model are therefore **process**-oriented (`addStep`, `connectSteps`,
…), not a generic `addNode`. The `kind`/`emotion`/`color` values are **enumerated** in the
schemas (no invention).

## Engine API actually available (all public via `@binarii/processii`)

| Need                       | Method                                                                 | Signature                                                                 |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Create a step/shape        | `engine.addElement(input, { select? })`                                | returns the normalized element. **`id` provided by the caller.**          |
| Link two boxes             | `engine.connect(id, startId, endId, opts?)`                            | routed arrow; `undefined` when an endpoint is missing. **`id` provided.** |
| Update                     | `engine.updateElement(id, patch)`                                      | partial revalidated `ElementPatch`; `false` when absent                   |
| Move                       | `engine.moveElement(id, dx, dy)`                                       |                                                                           |
| Delete                     | `engine.removeElement(id)`                                             | `false` when absent                                                       |
| Re-route after move/resize | `engine.refreshConnectors()`                                           | returns the number updated                                                |
| Read the state             | `engine.listElements()` / `engine.board.getElement(id)`                | sorted by z                                                               |
| Swimlanes                  | `engine.addSwimlane / updateSwimlane / removeSwimlane / listSwimlanes` |                                                                           |
| Observe                    | `engine.observe(() => void)`                                           | already wired to `forceRender` in `app.tsx`                               |

**Consequence #1 — id generation.** `addElement`/`connect` do not auto-generate ids: the tools
layer generates one (`crypto.randomUUID()`), uses it for the engine call, and **returns it to
the model** so it can connect/edit afterwards.

**Consequence #2 — orphan connectors.** `removeElement(stepId)` does not clean the arrows
referencing it. `deleteStep` must also remove the connectors whose `start`/`end` pointed to the
deleted step (walk `listElements()`), then `refreshConnectors()`.

**Consequence #3 — placement.** The model reasons poorly in coordinates. By default, the tools
layer **auto-places** a new `step` (left→right flow from the existing steps, or inside the
targeted swimlane); `x`/`y` remain **optional** params the model may override. After any
creation/connection batch, call `refreshConnectors()`.

## Building blocks to implement (in `apps/whiteboard-standalone/src/ai/`)

1. **`mistral-client.ts`** — `fetch` wrapper around `POST {BASE}/v1/chat/completions` with `tools`
   & `tool_choice:'auto'`. `BASE` **injected** (config): `https://api.mistral.ai` directly, or the
   proxy URL if CORS requires it (see the CORS section). **Injectable** client for the tests (no
   real network).
2. **`tools.ts`** — tool registry: for each one, a **zod schema** (runtime validation) + its
   conversion to **JSON Schema** via `z.toJSONSchema()` (zod v4, already available) for the
   `function.parameters` field. A single source of truth per tool.
3. **`dispatcher.ts`** — `(engine, toolName, rawArgs) → { success, result | error }`. Parses
   `arguments` (JSON string), validates via zod, executes the engine mutation, **always returns**
   a `role:'tool'` message (success **or** error, so the model can self-correct).
4. **`agent-loop.ts`** — agent loop (the brief's pseudo-code), `MAX_ITERATIONS = 8`. DOM-free,
   testable with a fake Mistral client and a `createEngine()`.
5. **`board-summary.ts`** — compact summary injected on every user turn: steps
   (`id` · `name` · swimlane · emotion) + connectors (`from → to`) + swimlanes. Not the raw JSON.
6. **`api-key.ts`** — `localStorage` helpers mapped onto `lib/session-creds.ts` (key
   `memorii.whiteboard.mistral-key`, `typeof localStorage` guard, try/catch). load/save/clear.
7. **`components/ai-chat-panel.tsx`** — UI: floating panel (same visual register as
   `SharePopover` / `SidePanel`: `@binarii/processii/ui` (primitives vendored from ui-kit, #95),
   lucide-react, Tailwind classes `bg-surface`/`border-border`). Key field (password type),
   history, input, activity indicator, **readable action trace**
   ("✅ Étape "Validation" ajoutée", "🔗 Réception → Validation").

**Mounting** in `app.tsx`: a button in the floating header opens the panel; it receives
`space.active.engine` + `forceRender` (already present). Disabled when `!space.active`.

## v1 tools — **full assistant** (decision made)

Goal: a **real assistant**, not a cramped MVP. The whole useful surface of the process model is exposed:

- **Steps**: `addStep({ name, description?, skills?, deliverables?, emotion?, swimlaneId?, x?, y? }) → { id }`,
  `updateStep({ id, name?, description?, skills?, deliverables?, emotion?, swimlaneId? }) → { ok }`,
  `deleteStep({ id }) → { ok }` _(+ orphan connector purge)_.
- **Connectors**: `connectSteps({ fromId, toId, withArrow? }) → { id }`,
  `disconnectSteps({ connectorId }) → { ok }`.
- **Swimlanes**: `addSwimlane({ name, color? }) → { id }`,
  `updateSwimlane({ id, name?, color? }) → { ok }`, `deleteSwimlane({ id }) → { ok }`.
- **Free shapes** (annotation outside the process): `addShape({ kind:'rectangle'|'ellipse'|'text', text?, x?, y? }) → { id }`.
- **Meta**: `setBoardName({ name }) → { ok }`, `setBoardBackground({ color }) → { ok }`.
- **Read**: `getBoardState() → { steps, connectors, swimlanes, name, background }`.

`emotion` ∈ `{happy,neutral,sad}`, `color` ∈ `SWIMLANE_COLORS`, `kind` ∈ restricted enum:
**enumerated** in the schemas to avoid invented values.

## Guardrails (repo DoD: strict, zero `any`, error cases covered)

- `MAX_ITERATIONS` = 8 (safety stop + clear message).
- Strict **zod** validation before any mutation; unknown type/emotion → error **sent back to the
  model**, no crash.
- **Confirmation** before a destructive action (`deleteStep`) — at least a "confirmation mode"
  toggle. (The standalone has no toast system: reuse the `window.alert` pattern or an inline
  confirmation in the panel, not a global toast.)
- Network errors / `401`/`403` (invalid key) / `429` (quota) → explicit messages, failure **not**
  silent.
- **Never log the key.** Offline-first preserved: without a key or offline, the chat is disabled
  but **the board works normally** (AGENTS.md invariant).

## ✅ CORS — settled: direct call, **no proxy** (2026-06-23)

Real test performed (`OPTIONS` preflight + real `POST` with a key):

```
OPTIONS https://api.mistral.ai/v1/chat/completions
  → access-control-allow-origin: *
  → access-control-allow-headers: Authorization,Content-Type,...
  → access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,OPTIONS,DELETE
POST .../chat/completions (mistral-small-latest, tools) → finish_reason: tool_calls ✓
```

→ **`api.mistral.ai` allows direct browser calls** (origin `*`, `Authorization` header allowed).
So **full front-side, `BASE = https://api.mistral.ai`, no backend added**: the standalone's
zero-backend / offline-first invariant is **preserved**. The client remains **injectable via its
`BASE`** anyway (useful for the tests, and a possible future proxy) — but no proxy is required.

**Model**: `mistral-small-latest` validated (tool use OK, `arguments` = JSON string to parse).
`mistral-medium-latest` can be offered as a quality option. `arguments` **is a JSON string** →
`JSON.parse`.

## Tests (Vitest, in the standalone app — DoD)

- `tools.test.ts`: zod → JSON Schema (enums present, correct required).
- `dispatcher.test.ts`: `tool_call` → real engine mutation (`createEngine()`), + error path
  (unknown type, missing id) returning a `role:'tool'` message.
- `agent-loop.test.ts`: **fake** Mistral client scripting `tool_calls` → assert the board state
  ("ajoute Validation après Réception" creates 1 step + 1 connector). Multi-turn. `MAX_ITERATIONS`.
- `api-key.test.ts`: load/save/clear `localStorage` (jsdom).
- **No real network** in the tests.

## Acceptance criteria (repo)

- [ ] CORS settled; architecture (direct vs proxy) decided and documented here.
- [ ] Mistral key entry / persistence / clearing (`localStorage`).
- [ ] "ajoute une étape Validation après Réception" creates the `step` and connects it, **visible live**.
- [ ] Chained actions (several creations/connections in one message) via the agent loop.
- [ ] The model always sees the **actual** state (summary recomputed on every turn, including
      after manual editing).
- [ ] Errors (invalid key, unknown type, quota) handled without crash, surfaced clearly.
- [ ] Mutations **only** through the engine (no DOM).
- [ ] `MAX_ITERATIONS` protects against infinite loops.
- [ ] Strict TS build + lint + green tests (`pnpm --filter processii-standalone typecheck|test|lint`).

## Decisions — made

1. **CORS / proxy**: ✅ direct, no proxy (see the CORS section). Zero-backend preserved.
2. **Tool scope**: ✅ **full assistant** (steps + connectors + swimlanes + shapes + meta + read).
3. **Placement**: ✅ auto-layout by the tools layer (`x`/`y` optional, overridden by the model
   when provided); `refreshConnectors()` after every batch.
4. **Mistral model**: ✅ `mistral-small-latest` (validated); `mistral-medium-latest` offerable as
   a quality option.
