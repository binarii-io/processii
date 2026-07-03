# processii-standalone

> **Public P2P site** — a collaborative whiteboard running **entirely in the browser**:
> no account, no server backend. Local multi-document space (offline-first via IndexedDB),
> **P2P** collaboration via WebRTC.

This app **assembles** existing building blocks — it reimplements no engine nor any editing UI:

- engine + rendering **and React editing UI**: `@binarii/processii` (`createEngine`, `renderToCanvas`,
  `connectAdapters`, and the `BoardCanvas`, `Toolbar`, `StylePanel`, `SidePanel`,
  `PresenceAvatars` components + presence helpers). These components used to live here; they were
  **promoted into the package** so a server-synced host app and this standalone share **the same
  editing code**. The standalone now only brings its **own chrome**: P2P sessions, invite link,
  sharing, multi-document sidebar, floating header (see `src/app.tsx`, `src/lib/space.ts`);
- CRDT provider contracts: re-exported by `@binarii/processii` (`TransportProvider`,
  `PersistenceProvider`, `ConnectionStatus`, doc/awareness helpers — the contract a host
  implements);
- UI components & tokens: `@binarii/processii/ui` (vendored primitives — `Button`,
  `Modal`, `Popover`, `AppShell`, … — plus the theme runtime helpers) and
  `@binarii/processii/styles.css` (embedded default values of the theming contract, light/dark).
  No hard-coded color; the Tailwind preset comes from `@binarii/processii/tailwind-preset`.

> **Single dependency.** This app depends on **`@binarii/processii` only** — no other workspace
> package — which keeps it self-contained. It is the showcase app of this repo,
> [`binarii-io/processii`](https://github.com/binarii-io/processii), the **source of truth** for
> the engine and this app. It imports `@binarii/processii/styles.css` (one sheet, the theming
> contract's default values, light/dark).

Communication happens **only** through this package's public interface (AGENTS.md).

## P2P model

- **Host/guest star**: a host opens a _room_; guests join it. Each peer exchanges its
  Yjs updates over **direct WebRTC**; a public **signaling server** only serves as a rendezvous
  (it never sees the board content, end-to-end encrypted by the room _secret_).
- **One session = a single document.** The transport binds to the Y.Doc of **one** document, not
  to the whole local space. **Hosting** shares the **current document** (its content **and its
  name** are broadcast to the peers). **Joining** (or opening an invite link) **always starts
  from a blank document dedicated** to the session: the guest's local content is **never** poured
  into the room — it arrives by sync from the host. The other documents of the space stay
  strictly local.
- **Synchronized document name.** The name is carried by the Y.Doc (`engine.get/setName`): when
  joining, the guest **adopts the host's document name** (and any in-session rename propagates to
  the peers).
- **Durable sessions + auto-reconnect.** Hosting or joining **remembers the credentials** (room +
  secret) on the document (`lib/session-creds`, `localStorage`). Re-hosting **reuses** the same
  credentials, and **reopening** a shared document **automatically rewires** its session.
- **Sharing UI = a single overlay** (`components/share-popover`, on the "Partager" button): an
  **"En ligne" toggle** (hosts / cuts while keeping the credentials → reconnection), the **invite
  link** to **copy**, and — in a collapsible section — the **room credentials** + a
  **"Régénérer"** button (new room/secret → new link, the old one no longer reaches us). The
  presence name ("Votre nom") is edited **in this same overlay**.
- **Joining** happens through a **small dialog** (`components/join-room-dialog`, "Rejoindre une
  room" button above "Créer un whiteboard" in the sidebar): room + secret entry, or a **pasted
  invite link** (unpacked automatically). The in-session document shows a **globe icon** in the
  sidebar (green when connected, gray when shared offline).
- **Arrival notification**: when a peer joins, a "X a rejoint le board" **toast** shows next to
  the presence avatars.
- **Named presence**: each peer publishes a cursor **name** and **color** (`lib/identity`),
  persisted in `localStorage` and **editable**. On first load, an `Invité-XXXX` name is generated.
- **STUN, no TURN in V1**: when NAT traversal fails (symmetric NAT), the connection fails
  **cleanly** (`disconnected` status) — the **local board keeps working**.
- **Offline-first by construction**: the engine edits without any adapter. The local persistence
  (`y-indexeddb`) and the P2P transport (`y-webrtc`) are **plugged in on demand** via
  `connectAdapters`; no P2P session is opened at startup.

### Trust boundary (signaling)

Everything touching the signaling is **validated/limited** (`SECURITY.md` §2,
`src/lib/signaling.ts`): room name on a bounded alphabet, bounded non-empty secret, remote
presence labels cleaned (control characters, length). A guest sees the host's **hosted document**
(the shared doc): that is an explicit boundary — no supposedly private data in a shared
standalone session. Conversely, **joining** shares **none** of the guest's pre-existing local
documents (dedicated doc).

## Canvas interactions

The canvas takes **all the space** (full frame, up to the top); the **header floats** on top
(title + avatars + Share + theme, no dedicated bar) and the **toolbar floats** at the
bottom-center. The canvas is rendered at the **screen density** (`devicePixelRatio`) with a
**minimum of 2×** (supersampling) — ×scale bitmap + scaled context — for **crisp strokes on
Retina/HiDPI** and **smoothed edges** even on a 1× screen (curves, rounded corners, text), as
close as possible to vector rendering. The **style bar** (stroke / fill / width) appears
**contextually above the selected element** (flips below near the top edge, and stays inside the
frame). The **properties panel** (step / lane) floats at the top-right, shown only when a step or
a lane is selected.

`BoardCanvas` routes the pointer/keyboard gestures to the engine; all the geometry goes through
the pure `@binarii/processii` helpers (`screenToWorld`, `hitTest`, `elementsInBox`, `zoomAt`…),
the zoom/pan being a **local state** (outside the CRDT):

- **click**: selects the element under the cursor (topmost); **shift+click**: multi-selection;
- **drag on empty space**: selection rectangle (marquee); **drag on the selection**:
  move with **snapping** (snap/guides on the neighbors' edges & centers);
- **handles** (single selection): **resizing** (8 handles) + **rotation** (Shift = 15° steps);
- **undo/redo**: ⌘/Ctrl+Z (Shift = redo), ⌘/Ctrl+Y, or the "Annuler" / "Rétablir" buttons;
- **styles**: **compact** bar floating above the selection — **Fill / Stroke chips** opening a
  **second panel** (palette) on click. The **Fill** panel offers _Fill / No fill_; the **Stroke**
  panel offers _Solid / Dashed / None_ (line style) + the palette. Plus the **width**,
  and — for a **connector** — **◀ / ▶** buttons (arrowheads);
- **sticky note**: "Sticky" button (colored-background text); **double-click** on a text =
  in-place editing (Enter commits, Escape cancels);
- **bound connector**: select 2 elements → the "Connecteur" button creates a bound arrow that
  re-routes when an endpoint is moved/resized;
- **connection handles (on hover)**: hovering a shape shows 4 N/E/S/W dots. **Clicking** a dot
  creates **the same shape** in that direction and links it; **dragging** from the dot draws a
  **connector** up to the dropped shape (or creates a shape at the drop point on empty space),
  linked to the source. Connectors are **right-angle routed** (orthogonal) as soon as the shapes
  are not aligned, with N/E/S/W **anchor sides**. During the drag, the target shows its anchor
  points and **highlights the one the link will attach to** (the side closest to the cursor) →
  allows **loops** (e.g. top↔top);
- **process board**: **Étape** (card node), **Swimlane** (lane) and **Groupe** (groups the
  selection) buttons; lanes/groups render under the elements;
- **editing panel** (on the right): selecting a **step** (click) edits name/description/skills/
  deliverables/emotion + deletion; selecting a **lane** (click on its header) edits
  name/type/**color** (palette)/height + deletion. **Double-click** on a step edits its name;
- **mouse-driven swimlane resizing**: dragging a lane's **bottom edge** changes its height, the
  **right edge** changes the shared width; the **cursor** reflects the available action (resize
  on the handles and edges, `move` on an element). The board **fills the available space**;
- the **step titles** display **on several centered lines** inside the card;
- **presence cursors**: the local cursor position is published via the **awareness**
  (`@binarii/processii`) and synced over P2P; the peers' cursors (name + color) display as an
  overlay. The **local selection** is published too: the elements selected by a peer show
  **highlighted in their color** (you see what others manipulate). In session, the topbar shows
  **avatar chips** (colored initials) of the connected participants, self included
  (`PresenceAvatars`, Notion style). On each (re)connection, the awareness is **renewed**
  (`MountedDocument.renewAwareness`)
  — y-webrtc removes the local presence state on disconnect, so starting from a fresh awareness
  guarantees the peers' cursors reappear **without refreshing the page** when returning to a doc;
- **wheel**: pan; **ctrl/⌘+wheel**: cursor-anchored zoom; **space+drag** or **middle click**:
  pan; zoom control (−/%/+, % = reset) as an overlay;
- **Delete/Backspace**: removes the selection; **Escape**: deselects.

## Local persistence (offline)

Each sidebar document can be **renamed** (pencil icon or double-click on the name; Enter commits,
Escape cancels) and **deleted** (trash icon, with confirmation) — both icons appear on **hover**
of the row. Deleting the active document switches back to the first remaining one; deleting a
parent removes **in cascade** all its descendants (sub-processes included).

The sidebar is **hierarchical**: a document can have a `parentId` and then displays **nested**
under its parent. That is the support for **sub-processes**: on a whiteboard, the
**"Sous-process"** button (or a step's panel) creates a **child** whiteboard
(`createDocument(name, { parentId, open:false })`) linked to a step; **double-clicking** the
linked step → you **enter** the child (`openDocument(id)`). A linked child carries a **⚠ badge**
in the sidebar and its deletion shows a **strengthened confirmation** (deleting it breaks the
link from the parent's step). Documents are **reordered** by **drag-and-drop** in the sidebar
(among siblings of the same parent only; no reparenting, everything being a whiteboard); the
order = the local array's, persisted (localStorage + bundle).

Each document's **content** is persisted in **IndexedDB** (`y-indexeddb`, one store per doc) and
the space's document **list** (id + name **+ parentId**) in `localStorage`
(`memorii.whiteboard.space`). On reload, the list is restored and each doc's content
**rehydrates** from IndexedDB (mount without `initialScene` when the scene is empty). Disabled in
**demo mode** (E2E/preview) → ephemeral state. The save-bundle below remains the explicit
export/share.

## Save bundle (import / export)

`src/bundle.ts` serializes the space (multi-document) into a portable, **lossless** `.json` file
(each document = a native `Scene`). An imported file is an **untrusted input** (zod validation +
`parseScene`):

- **new space** (`bundleToNewSpace`): replaces the current space;
- **merge** (`mergeBundleIntoSpace`): adds the imported documents to the current space **with ID
  remapping** (documents _and_ elements) → re-importing the same bundle **never** creates a
  collision. The remap also follows the **links**: `parentId` (doc→doc) and `subprocessRef`
  (step→doc) are rewritten to the new IDs, so the hierarchy and the sub-processes stay intact
  after a merge.

## AI assistant (Mistral chat → live board editing)

A **chat module docked on the right** (header's ✨ button) lets you **modify the board in natural
language**: "ajoute une étape Validation après Réception et relie-les". Everything is
**front-side, no backend** — true to this app's zero-server spirit. Details & decisions:
[`docs/ai-chat-brief.md`](docs/ai-chat-brief.md).

- **Docked & animated module**: a real vertical pane (not an overlay) that **shrinks the board
  area** when opening (animated width), **resizable** via the left handle (persisted width,
  `src/ai/panel-width.ts`). Replies rendered as **markdown** (`src/components/markdown.tsx`),
  user bubbles on the right. The **settings** (API key, deletion confirmation, instructions) are
  grouped under the panel's ⚙️ icon.

- **Personal API key**: the user enters their **Mistral key**, stored in `localStorage`
  (`src/ai/api-key.ts`) and sent **directly** to `api.mistral.ai` (browser CORS **validated**:
  origin `*`, `Authorization` header allowed → **no proxy**).
- **Client-side agent harness** (`src/ai/`): `mistral-client` (injectable `chat/completions`
  wrapper, **tool use**), `tools` (tool registry = **zod** schema + derived JSON Schema + handler
  on the engine), `dispatcher` (routes a `tool_call`, validates, executes, **always replies**),
  `agent-loop` (agent loop, `MAX_ITERATIONS`, destructive-action confirmation), `board-summary`
  (compact state re-injected on every turn).
- **Auto-continuation**: a turn is capped at `MAX_ITERATIONS` round-trips (controlled cost); when
  the task is not finished, the panel **automatically relaunches** (up to `AUTO_CONTINUE_MAX`,
  the board state being re-injected) → big processes build themselves, without the user typing
  "continue".
- **Model-picked ids**: the creation tools accept an `id` (stable slug) provided by the model,
  which it **reuses** to connect/edit — instead of opaque UUIDs it would have to guess (cause of
  the "id not found" errors). Lanes can be referenced by **id OR name**.
- **Mutations through the shared engine only** (`@binarii/processii`, never the DOM). Tool
  surface aligned with `ElementPatch`:
  - steps: `addStep`, `updateStep` (content, emotion `'none'`=remove, **formatting**
    bold/italic/underline/strike/fontSize/textAlign, **appearance** fill/stroke/strokeWidth/opacity/shadow/
    showDescription, **geometry** x/y/width/height → move·resize, link re-routing),
    `moveStepToLane` (**ACTUALLY tidies** a card into a lane: sets `swimlaneId` **and**
    repositions the card — centers vertically, enlarges the lane when the card is taller;
    preferred over `updateStep(swimlaneId)` which does not move the card),
  - links: `connectSteps` (endArrow/startArrow), `connectFlow` (links a sequence of ids in one
    call), `tidyFlow` (finalizes the **links**: completes the per-lane sequence + fixes reversed
    directions), `disconnectSteps`,
  - layout: `tidyLayout` (the **geometric** counterpart of `tidyFlow`: grows the too-small lanes,
    recenters the cards inside their lane, extends the width — without ever shrinking),
  - inter-lane handoff: `addHandoff` (creates the **vertically aligned** sent/received pair + link),
  - free shapes: `addShape`, `updateShape` (text + formatting/appearance/geometry),
  - lanes: `addSwimlane` (name-based anti-duplicate, `laneType` user/system/custom) /
    `updateSwimlane` (name/type/color **+ `height`** to resize it) / `setLanesWidth` (**shared
    width** of all lanes, floor = does not cut the cards) / `reorderSwimlane` (**vertical
    reordering**: absolute `toIndex` or `before`/`after` another lane; the cards follow) /
    `deleteSwimlane`,
  - generic: `deleteElement` (step, shape or link; purges the orphan links),
  - meta + read: `setBoardName`, `setBoardBackground`, `getBoardState`.
    The board updates **live** during the loop.
- **Geometric board state** (`src/ai/board-summary.ts`): the summary injected each turn includes
  the **geometry** (card positions, lanes `y top→bottom`, **shared width**) and **flags the
  inconsistencies** — a card whose `swimlaneId` does not match its actual position is marked
  `⚠ hors de sa bande`. Without that, the model "tidied" cards by setting `swimlaneId` without
  moving them, and claimed it done without seeing the gap (#89). It can now detect and fix
  (`moveStepToLane` / `tidyLayout`).
- **Persisted conversations** (`src/ai/conversations.ts`, `localStorage`): the history **survives
  a refresh**; one can **resume** a conversation, **start a new one**, or delete one (selector in
  the panel header). The API history sent to Mistral is **rebuilt** from the displayed thread
  (`threadToHistory`).
- **Permanent instructions / "skills" pre-prompt** (`src/ai/instructions.ts`): an editable free
  text (panel's ⚙️ Settings), persisted, **injected into the system prompt** on every turn and
  applied to all conversations (language, naming conventions, process style, business
  constraints…).
- **"Business process" skill** (`src/ai/process-skill.ts`): modeling best practices (swimlanes =
  actors as horizontal lanes, **left→right temporal flow**, attachment, connectors = sequence)
  **automatically injected** when the message mentions a process/business/swimlane **or** the
  board already contains swimlanes. Prevents the assistant from stacking steps or breaking the
  sequence.
- **Guardrails**: strict zod validation (unknown type/emotion → error **sent back to the
  model**), iteration limit, deletion confirmation, `401`/`403`/`429` handling, **key never
  logged**. At creation, steps have **no emotion** (the model can only set one on request, via
  `updateStep`; `emotion='none'` removes it). Without a key or offline: the chat is disabled,
  **the board works normally** (offline-first).

> Default model: `mistral-small-latest` (tool use validated). The key is **never** a build
> variable: it stays on the user's side (see below, no secret goes into the bundle).

## Environment variables (build-time, public)

Injected at **build** time by Vite (`VITE_*`, hence exposed to the bundle → **never a secret**).
Validated with zod (`src/lib/env.ts`):

| Variable              | Default                        | Role                                                                                                               |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `VITE_SIGNALING_URLS` | `wss://signaling.binarii.app`  | y-webrtc signaling (list, `,`). Default = our Cloudflare Worker (`infra/signaling-cf`, domain in TF binarii-infra) |
| `VITE_STUN_URLS`      | `stun:stun.l.google.com:19302` | STUN servers (list, `,`). No TURN in V1.                                                                           |
| `VITE_E2E`            | —                              | `1` → **demo mode**: no network (E2E/preview).                                                                     |

The signaling/STUN URLs are **public by nature**; no secret goes there. A session's encryption
_secret_ is generated client-side and shared out-of-band (invite link).

## Run in dev / build

```bash
pnpm --filter processii-standalone dev      # Vite dev server (http://localhost:5174)
pnpm --filter processii-standalone build    # prod bundle (PWA) + types
pnpm --filter processii-standalone preview   # serves the build (http://localhost:4174)
```

> Demo: `pnpm --filter processii-standalone dev` then open http://localhost:5174 — create a
> document, draw; open a second browser and "Héberger une session" / "Rejoindre" for P2P collab
> (public signaling by default).

## Deployment (Firebase Hosting)

**Static site (PWA)** → **Firebase Hosting** (same pattern as `fetchlii` / `binarii.io`), DNS via
Cloudflare managed with Terraform (`binarii-infra`). Hosting config: `firebase.json` (SPA rewrite +
long cache on the hashed assets, `no-cache` on `index.html`/`sw.js`/manifest).

Firebase project: **`processii`** (already set in `.firebaserc`). Public domain: **`process.binarii.app`**.

```bash
# 1) Build (default VITE_SIGNALING_URLS = wss://signaling.binarii.app)
pnpm --filter processii-standalone build

# 2) Deploy (from this folder; project = processii via .firebaserc)
cd apps/standalone
npx firebase login
npx firebase deploy --only hosting
```

> **Domain** `process.binarii.app`: add it as a _custom domain_ in the Firebase console (project
> `processii`) → fetch the records (A/TXT) → declare them in **Terraform** in
> `binarii-infra` (DNS-only while the certificate provisions).

## Public interface

The only importable surface (`src/index.ts`) exposes the **reusable, network-free-testable**
building blocks (the React app is NOT exported): bundle model, document mounting
(`mountDocument`), CRDT providers (`createWebrtcProvider`, `createIndexeddbProvider`), signaling
boundary, config and wiring (`createWiring`).

## Testing

```bash
pnpm --filter processii-standalone test       # Vitest (+ Testing Library)
pnpm --filter processii-standalone typecheck  # tsc --noEmit (strict, zero any)
pnpm --filter processii-standalone lint       # eslint
pnpm --filter processii-standalone test:e2e   # Playwright (loads the site, draws, AI assistant)
```

Coverage (**real** tests, no stub):

- **bundle**: export/parse round-trip, new space, **merge + ID remapping** (no collision even on
  re-import), error cases (broken JSON, invalid structure/scene, duplicated IDs);
- **P2P collaboration**: 2 peers converge via a **fake contract-conforming transport**
  `TransportProvider` (Yjs update relay) — **no real network WebRTC** in tests (`src/test/
fake-transport.ts`), including a late guest's initial sync and live propagation;
- **y-webrtc transport** (`createWebrtcProvider`, exported/reused by #17): unit tests with
  `y-webrtc` **mocked** (`vi.mock`, **no real network**) — wiring (room/doc/signaling/password,
  `awareness`, `stunUrls → iceServers`), `connected → ConnectionStatus` mapping
  (`connecting`/`connected`/`disconnected`, no `failed`), `connect()` resolution (synced /
  status change / alone-in-the-room), `disconnect`/`destroy`;
- **offline-first**: mounting and editing a document **without any adapter**;
- **signaling**: validation/limitation (room, secret, remote labels) — `SECURITY.md` boundary;
- **presence identity** (`lib/identity`): name cleaning (control characters, length,
  `Invité-XXXX` fallback), name/color generation + persistence, re-read, invalid color rejected;
- **session panel**: "Votre nom" field (editing), **host → `onHost`** (shares the current doc)
  vs **join → `onJoin`** (dedicated doc); already-shared document → **reconnect** /
  **stop sharing** (and no more "host" button) — covers the durable session;
- **session credentials** (`lib/session-creds`): save/load round-trip, forget (clear), shared doc
  list, corrupted entry rejected;
- **document sidebar**: in-place **rename** (pencil or double-click, Enter commits / Escape
  cancels) and **deletion** (trash, with confirmation) — affordances revealed on row hover;
  **globe icon** on the shared documents (green when connected, gray otherwise);
- **env / wiring**: validated public config, P2P cleanly refused on invalid room/secret,
  disabled in demo mode;
- **app (RTL)**: offline mount, document creation, local editing, P2P disabled in demo;
- **AI assistant (Playwright e2e, `e2e/ai-assistant.spec.ts`)**: **full** UI chain with Mistral
  **mocked** (`page.route`, no key) — panel → loop → tools → engine → canvas. Verifies both #89
  cases: a card outside its lane is **actually** tidied into it (`moveStepToLane`) and a lane is
  **actually** enlarged (`updateSwimlane height`). The **actual geometry** is read via
  `window.__wbEngine` (the active engine, exposed **in demo mode only** `wiring.demo` because the
  board is rendered on a pixel `<canvas>`). Run by the CI (the `e2e` job in `ci.yml`);
- **canvas (RTL)**: gesture routing to the engine — click selection, empty-click deselection,
  shift multi-selection, marquee, drag move, **handle resizing and rotation**, keyboard deletion
  (`PointerEvent` polyfilled in jsdom);
- **toolbar / style-panel (RTL)**: shape addition, **undo/redo** (undoes/redoes, button disabled
  on empty stack), **bound connector** (enabled when 2 selected), stroke/fill/width application;
- **in-place text editing (RTL)**: double-click → editor, Enter commits the change;
- **presence (RTL + unit)**: awareness helpers (cursor publishing/reading, local client
  exclusion), rendering of a peer's cursor propagated via `applyAwarenessUpdate` (no real network);
- **E2E (Playwright)**: load the site → create a document → draw a shape.
