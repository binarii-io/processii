# @binarii/processii

> Engine + rendering + **React UI** of a collaborative, **offline-first** whiteboard/process
> board (Yjs), reusable both by a server-synced host app and by the P2P standalone
> (`processii-standalone`) — **a single editing code base** for both.

**Document-shaped** module: native data, CRDT, live collab, offline-first, pluggable
sources. The importable surfaces are `src/index.ts` (engine + editor + CRDT/adapters contract)
and the **`@binarii/processii/ui`** subpath (vendored UI primitives).

> **Open source.** This package lives in the public repo
> [`binarii-io/processii`](https://github.com/binarii-io/processii) — its **source of truth** —
> and is published to npm as `@binarii/processii` (Apache-2.0). It is **self-sufficient**: no
> workspace dependency. The Yjs aliases and provider interfaces (`src/crdt/`) and the UI
> primitives and tokens (`src/ui/`) are **vendored**, so a host can supply structurally
> compatible implementations without any shared package.

## Layered architecture

```
scene      lossless native model (shapes/transforms) + zod validation at the boundaries
  └─ board (Yjs, src/crdt)   convergent collaborative state: add/move/update/remove
       └─ engine             operations + LOCAL selection + geometry + render model
            ├─ render        DOM-free 2D Canvas renderer, colors via semantic tokens (src/ui)
            ├─ viewport      world↔screen transforms (zoom/pan), pure — LOCAL presentation state
            ├─ hit-test      point / marquee selection, rotation-aware, pure
            ├─ handles       resize handles (8) + rotation, rotation-aware, pure
            ├─ snap          alignment/snapping on edges & centers, pure
            ├─ history       undo/redo via Y.UndoManager, scoped to local edits
            ├─ connector     edge-to-edge routing of an arrow bound to two elements, pure
            └─ adapters      transport / persistence (src/crdt interfaces) + identity, pluggable
  src/crdt   vendored Yjs helpers + provider interfaces (the host-implemented contract)
  src/ui     vendored UI primitives + tokens/themes/preset (the theming contract)
  excalidraw / drawio        lossy export + defensive import, markers for the irreducible
```

The **core is DOM-free**: it runs in Node (tests), workers, the P2P standalone and the web app
with no environment dependency. The network is never required to edit (offline-first by
construction); it is plugged in via the adapters.

## Scene model

A `Scene` is a flat set of `WhiteboardElement` (**lossless** native format, the "save"):

| kind        | geometry            | specifics                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rectangle` | x, y, width, height | `text?` (centered label), `shadow?` ("card" shadow, default on)                                                                                                                                                                                                                                                                                                                     |
| `ellipse`   | x, y, width, height | `text?` (centered label), `shadow?`                                                                                                                                                                                                                                                                                                                                                 |
| `line`      | x, y (+ `points[]`) | `points` ≥ 2 (relative)                                                                                                                                                                                                                                                                                                                                                             |
| `arrow`     | x, y (+ `points[]`) | `points` ≥ 2 (relative)                                                                                                                                                                                                                                                                                                                                                             |
| `text`      | x, y, width, height | `text`, `fontSize` (+ `fill` ≠ transparent ⇒ **sticky note**, `shadow?`)                                                                                                                                                                                                                                                                                                            |
| `step`      | x, y, width, height | **process board** node: `name`, `description` (+ `showDescription?` to show it on the card), `skills[]`, `deliverables[]` (rendered as **pills**: skills accent tint, deliverables success tint), `emotion?` (clearable), `shadow?` ("card" shadow **default on**), `swimlaneId?`. "Item" defaults: **white background** (`fill: surface`) + **no outline** (`stroke: transparent`) |

**Per-element text format** (text/step/rectangle/ellipse): `textAlign` (`left`/`center`/`right`),
`bold`, `italic`, `underline`, `strike`, `fontSize` — all optional, applied to **all** of the
element's text (no per-character rich text). A shape's label is typed **on double-click**
(centered in-place editor). **Items** (shapes **and** steps) default to a **white background**
(`surface`), **no outline**, detached by a **drop shadow** — disableable per item (`shadow: false`).

Common fields: `id`, `angle`, `stroke`, `fill`, `strokeWidth`, `opacity`, `z` (render order),
`markers[]`. The `stroke`/`fill` colors are either a **semantic token** of the theming contract
(`text`, `accent`, …) or a free (imported) value. Every input goes through zod (`parseElement`,
`parseScene`) → typed `WhiteboardParseError` when invalid.

Every element also carries an optional **`data`** bag (`Record<string, unknown>`) — an **extension
point** the engine passes through untouched and never interprets, for a host to attach app-specific
metadata without forking the schema (stored opaquely like `markers` ⇒ last-writer-wins on the whole
bag). At the **scene level**, **`boardType`** classifies the whole board (`process` | `architecture`
| `ideation`, default `ideation`) — read/write it via `board.getBoardType()`/`setBoardType()`
(shared in collab through the meta map, like the name/background). Both are **additive** (no
`DOC_SCHEMA_VERSION` bump); phase 1 is a **label only** (the engine renders identically per type).

## Collaboration (Yjs)

Each element is a `Y.Map` indexed by `id`. Two **concurrent modifications of different fields**
of the same element merge without loss; the same field written concurrently is resolved
deterministically by Yjs. Convergence proved by the tests (`board.collab.test.ts`). Network
wiring (in-app websocket, standalone y-webrtc) goes through the **local provider interfaces**
(`src/crdt/providers.ts`, the contract hosts implement) injected via the adapters —
never hard-coded here.

**Every write is a validated boundary.** `addElement`/`loadScene` validate the input, and
`updateElement` revalidates the **resulting** element (current state + patch) against the zod
schema **before** mutating the `Y.Map`: a patch that would break the invariant (negative
`width`, `NaN`/non-finite coordinate, `opacity` outside `0..1`…) throws `WhiteboardParseError`
**without writing anything**. The "every stored element is valid" invariant is thus guaranteed —
an invalid update cannot poison the reads (`toScene`/`listElements`/`getElement`/`toRenderModel`),
which revalidate as well.

## Document format & compatibility

Persisted boards (users' IndexedDB, consumers' databases) carry a **Y.Doc schema version** — the
integer `schemaVersion` in the board's meta map, exposed as the constant **`DOC_SCHEMA_VERSION`**
(currently `2`). It is stamped on a document's first edit and read back via
`board.getSchemaVersion()` (an older, unstamped document reads as `1`, the pre-marker baseline).

**Compatibility policy (guaranteed):**

- **A newer build reads an older document — always ("N+1 reads N").** Field-level changes are
  already additive-tolerant (zod strips unknown keys and defaults missing ones), so most evolution
  needs no bump; a future breaking change migrates the old document **on read**.
- **An older build meets a newer document — it refuses.** `board.assertReadable()` (and
  `engine.assertReadable()`) throws **`WhiteboardSchemaVersionError`** when the document's
  `schemaVersion` exceeds `DOC_SCHEMA_VERSION` — a breaking change the build cannot understand. It
  never silently mis-reads persisted or shared data; the host surfaces an "update required" state.
  `boardFromDoc`/`engineFromDoc` run the check **eagerly** (they attach to an already-hydrated
  doc); a host that creates **then** hydrates (e.g. via a persistence provider) calls
  `assertReadable()` itself once `whenLoaded()` resolves.

**When to bump `DOC_SCHEMA_VERSION`:** only for a **breaking structural change** to the Y.Doc
layout — a new/renamed top-level `Y.Map` key, a new element `kind`, a changed literal — paired with
a migration from the previous version. Adding an optional field does **not** bump it.

**v1 → v2 (swimlane clusters), migrated on read.** v2 adds a `whiteboard:swimlaneClusters` `Y.Map`
and a `clusterId` field on each lane so swimlanes stack per **freely-positioned cluster** instead of
a single top-anchored column (see [Process board](#process-board-process-model)). A v1 document
(lanes with no `clusterId`, no cluster map) is migrated **as a pure read-time projection — never a
doc write**: an unstamped `clusterId` defaults to the constant **`LEGACY_CLUSTER_ID`**, and the one
synthetic legacy cluster sits at the origin with the old shared `swimlanesWidth` as its width (kept,
now deprecated). The projection is convergent because the legacy id is a compile-time constant, so
every peer projects the identical cluster; detach mints deterministic ids (`cluster-of:<laneId>` — a
fixed prefix on the unique lane id, injective and colon-safe) for the same reason. A cluster's
identity is defined by **lane membership**, not by a map entry (an
empty cluster is never projected), so structural edits stay convergent. Per the policy above, a v1
build **refuses** a v2 document (`assertReadable` → `WhiteboardSchemaVersionError`).

This `schemaVersion` (the live CRDT layout) is **distinct** from `sceneSchema.version` (the exported
`Scene`/bundle JSON version, also bumped to `2` for the `swimlaneClusters` array): two surfaces, two
version numbers, which may evolve independently.

## Rendering

`engine.toRenderModel()` produces a sorted model + selection state. `renderToCanvas(ctx, model)`
draws on any `CanvasLike` (the real `CanvasRenderingContext2D` or a test double).
**Zero hard-coded colors**: `resolveColor` maps the semantic tokens to `var(--color-<token>)`
(follows the active theme — see "Theming" below); an imported literal color passes through
unchanged. The selection frame uses the `accent` semantic token. The `strokeDash` **stroke
style** (`solid`/`dashed`) renders **solid or dashed** outlines (via `setLineDash`, world scale).
The `remoteSelections` option (collab) draws, **in each peer's color**, a highlight around the
elements they selected — to see what others are manipulating (the presence/awareness lives on
the app side, the engine only paints).

## Viewport & hit-testing (interaction)

The engine stores absolute **world** coordinates (what converges in collab and persists offline).
**Zoom/pan** is on the contrary a **local presentation** state (like the selection): a pure
`Viewport { x, y, zoom }`, outside the CRDT. `viewport.ts` provides the world↔screen transforms
(`screenToWorld`, `worldToScreen`), the pan (`panBy`), the **cursor-anchored zoom** (`zoomAt`,
saturated within `[MIN_ZOOM, MAX_ZOOM]`), `viewportCenter(viewport, size)` — the world point at
the **center of the visible canvas** (pure companion of `screenToWorld`), used to drop freshly
created items where the user is looking rather than at a fixed world position — and
`visibleWorldRect(viewport, size)`, the **whole visible region** in world coordinates (a
`BoundingBox`), used to reason about _what the user is looking at_ (e.g. context-aware swimlane
placement, see [Process board](#process-board-process-model)). `renderToCanvas`
applies this viewport (`translate` + `scale`) and can draw a **marquee rectangle**; the UI
indicators (selection, marquee) compensate for the zoom to stay ~1px on screen.

`hit-test.ts` answers "which element under this point?" (`hitTest`, topmost by z) and
"which elements inside this rectangle?" (`elementsInBox`, bbox intersection). The test is
**rotation-aware**: for solid shapes the point is brought back into the element's local frame
before testing; for lines (line/arrow) the distance to the segments is measured with a tolerance
(`DEFAULT_HIT_TOLERANCE`, typically divided by the zoom to stay constant on screen). Like the
rest of the core, both modules are **pure and DOM-free** → tested without a browser.

`handles.ts` places, for a **box-shaped** element (rect/ellipse/text), 8 resize handles + 1
rotation handle (`elementHandles`), hit-tests them (`handleAtPoint`) and computes the new state:
`resizeElement` keeps the opposite edge **fixed in the world** (correct even for a rotated
element), `rotateElement` returns the angle (optional 15° snapping via `snapStep`).
`snap.ts` (`snapMove`) snaps a moving box onto the **edges and centers** of the other elements
under a threshold and returns the `(dx, dy)` correction + the guide lines. `renderToCanvas`
draws the handles (**single** selection) and the guides. Pure, tested modules.

## Process board (process model)

Beyond the shapes, the engine carries the **process board** model: the `whiteboard`
document type. In addition to the `step` elements (card nodes), the scene contains
two **collections** stored in the CRDT board next to the elements:

- **swimlanes** (`Swimlane`) — horizontal bands belonging to a **cluster** (`clusterId`), ordered
  **within their cluster** (`order`, `height`, `color`, `laneType`). CRUD:
  `engine.addSwimlane/updateSwimlane/removeSwimlane/listSwimlanes`.
- **swimlane clusters** (`SwimlaneCluster`) — freely-positioned, **aligned** blocks: lanes sharing a
  `clusterId` stack vertically from the cluster's (`x`, `y`) and share its `width`. A cluster's
  identity comes from **lane membership**; the `whiteboard:swimlaneClusters` map only stores
  position/size **overrides** (`engine.listSwimlaneClusters/getSwimlaneCluster/addSwimlaneCluster/
updateSwimlaneCluster/removeSwimlaneCluster`). The legacy shared `swimlanesWidth`
  (`get/setSwimlanesWidth`) is **kept but deprecated** — it backs the single legacy cluster of a
  migrated v1 doc (see [Document format & compatibility](#document-format--compatibility)).

  **Move / attach / detach.** Lanes and clusters are freely movable with **magnetic** attach/detach:
  - `engine.moveCluster(id, dx, dy)` translates a whole cluster **and its lanes' content** together.
  - `engine.detachSwimlaneTo(id, x, y)` pulls a lane out into its own new cluster (deterministic id
    `cluster-of:<laneId>`), carrying its content and reflowing the source.
  - `engine.attachSwimlane(id, targetClusterId, atIndex?)` merges a lane into another cluster,
    adopting its `x`/`width` and closing the gap it leaves.
  - `engine.reorderSwimlane(id, targetIndex)` reorders **within a cluster** (renumbers `order`).

  **Context-aware creation.** `engine.addSwimlaneInView(input, visible?)` places a new lane by
  what the user is **looking at**: given the visible world rect (`visible`, from
  `visibleWorldRect` — see [Viewport](#viewport--hit-testing-interaction)), the lane is **appended
  to the most-visible existing cluster** (largest intersection area; deterministic tie-break), or —
  when no cluster is on screen — a **fresh cluster is created centered on the view** (id injective
  in the lane, `cluster-of:<laneId>`) so it appears in the middle of the screen instead of snapping
  back onto the first block. With no `visible` (host not wired / before the first canvas measure) it
  falls back to the historical legacy-block placement. The cluster override (when a new block is
  made) and the lane are written in **one transaction** (atomic for peers, one undo step). Returns
  the lane, its world `band` and `createdCluster`, so a host can recentre the view on the new lane.

  All four **carry each lane's content by geometry** — any non-connector element whose **center**
  falls inside a lane's band follows it (not only steps "attached" via `swimlaneId`: a card dropped
  by hand follows too) — then re-route connectors. On the UI side (`board-canvas`): **dragging a
  lane header** previews reorder / attach / detach (a translucent **ghost** follows the cursor, an
  accent **drop line** marks the reorder/attach slot; far from every cluster → detach), committed on
  release; **dragging a cluster's left-edge grip** moves the whole linked block — the grip (and an
  outline of the block it will move) is **revealed on hover** of that left-edge zone, not shown
  permanently; **the bottom edge** resizes a lane's height, **the right edge** the cluster's width.
  `grab`/`grabbing` cursor; a plain click only selects.

- **agentGroups** (`AgentGroup`) — **generic named** groupings of steps (`stepIds[]`). CRUD:
  `engine.addAgentGroup/updateAgentGroup/removeAgentGroup/listAgentGroups`.

The board also carries a **shared document name** (`engine.get/setName`, stored in the Y.Doc
meta map): synced in collab like everything else, it lets e.g. a guest **adopt the host's
document name** when joining a session. `null` when unset; empty string ignored.

The **board background color** is shared too (`engine.get/setBackground`, meta map + the scene's
`background` field): semantic token or CSS literal, `null` = theme default (`setBackground(null)`
or empty string resets). The `Toolbar`'s **color block** (swatch + soft-tone popover +
"Par défaut") drives it; `BoardCanvas` applies it as the `<canvas>` background.

**Sub-process.** A step can carry a `subprocessRef`: the **opaque id** of a child whiteboard
document. The package stays **document-agnostic** — it does not know what `ref` is, it
**displays** it (↗ badge + indicator on the card) and **surfaces a double-click** via
`onNavigateSubprocess(ref)`. The **creation** of the child document is also delegated to the app
via `onCreateSubprocess(): Promise<string | null>` (returns the new child's id), wired to the
toolbar's **"Sous-process"** button and the `SidePanel` section (link / open / unlink).
Unlinking = `engine.updateElement(id, { subprocessRef: null })`. Both callbacks are props of
`WhiteboardEditor`; each app (web sync, P2P standalone) plugs in its own document management
(child creation, navigation by id).

> The `subprocessRef` is **owned by the source step**: creating a **connected** item (connection
> handles: "direction" click or drag-to-empty-space) takes the type/style but **starts blank of
> sub-process** (otherwise two steps would point to the same child document). The link is never
> copied on clone (`board-canvas.ts`, `cloneShapeAt`).

Connections between steps reuse the **bound arrows** (`start`/`end` by id, `engine.connect`
/ `refreshConnectors`). Routing is **orthogonal** (Manhattan, `connector.ts`): perpendicular
exit/entry through an anchor side (`startSide`/`endSide` ∈ N/E/S/W, pinned or auto
face-to-face), right-angle elbow, and **simplification** of the collinear points (an aligned
case becomes a straight line again; identical pinned sides, e.g. `n`→`n`, produce a **loop**).
Optional arrowheads at the ends (`startArrow`/`endArrow`), rendered as solid triangles oriented
along the last segment. `toScene`/`loadScene` cover elements + swimlanes + clusters + groups + width;
`observe` notifies on **all** collections; the undo/redo history covers them all.
`skills`/`deliverables` are **free-form labels** (no registry — free adaptation).

**Rendering**: `toRenderModel()` computes the process layout — swimlanes positioned **per cluster**
(each lane at its cluster's `x`/`width`, stacked by `order` from the cluster's `y`) and the groups'
bboxes (enclosing the member steps + margin).
`renderToCanvas` draws, **under** the elements, the lanes (translucent background mapped to a
semantic token + header + separator) then the groups (frame + label in `accent`), before the
elements/handles/guides.

## Undo/redo & styles

`engine.history()` returns an undo/redo history (`WhiteboardHistory`) backed by Yjs's
**`Y.UndoManager`** — consistent with the CRDT, and **scoped to the board's local origin**: it
only undoes **this user's** edits, never those received from a peer (the board's transactions
are tagged with a dedicated origin). The UndoManager groups close-in-time mutations into one
step (one drag = a single undo); `observe()` notifies stack changes (`canUndo`/`canRedo`).
`engine.updateSelection(patch)` applies a patch (typically **style**: `stroke`/`fill`/
`strokeWidth`/`opacity`, **text format** `textAlign`/`bold`/`italic`/`underline`/`strike`/
`fontSize`, **shadow** `shadow`, semantic tokens) to the whole selection, through the same
validated boundary. The **contextual style bar** (`StylePanel`, above the element) exposes
fill/stroke, and — for a text-bearing element — the alignment, format and shadow toggle.

## Bound connectors & sticky notes

`engine.connect(id, startId, endId)` creates a **bound arrow**: its native `start`/`end` fields
reference two elements and its `points` are routed **edge to edge**, at right angles
(`connector.ts`, `connectorGeometry`). `engine.refreshConnectors()` re-routes all bound
connectors (call after a move/resize). The links are native (kept in the lossless save; ignored
by the interop exports, lossy).

**Robustness (the link always holds).** Two guards guarantee that a link **stays attached** no
matter what: (1) `connectorGeometry` never returns **fewer than 2 points** — when the two boxes
**coincide** (a step moved onto another, or stacked by the layout), the path falls back to the
raw `[start, end]` segment instead of collapsing to an invalid single point (`points: min 2`,
`scene.ts`); (2) `refreshConnectors` is **resilient**: each connector's update runs in
isolation, so a link with problematic geometry does **not interrupt** the re-routing of the
others. Without these guards, moving a step onto another raised "points: Invalid input" and
**froze all the links**.

**Movable elbow.** A connector's crossing segment is **centered by default** but **movable**:
optional native `midpoint` field (world coordinate; the **axis** — `y` to move a horizontal
segment up/down, `x` for left/right on a vertical one — is derived from the routing).
`connectorElbow(a, b, opts)` returns `{ axis, pos, default, handle }` (where to place the
handle, which axis to drag on, and the center for the snap). `engine.setConnectorMidpoint(id,
value | null)` moves the elbow (`null` = recenter/auto). On the UI side (`board-canvas`), a
selected connector shows a **handle** at the middle of the segment: dragging moves it (center
snap at ~6 px), **double-click** = recenter. Mixed case (perpendicular sides): the L becomes a
**Z** when the elbow is offset.

A **sticky note** is not a new kind: it is a `text` element with a non-transparent `fill` — the
renderer then draws a background + the (multi-line) text with a margin. In-place text editing is
handled on the app side (overlay), via `updateElement`.

## Interop export / import (lossy + markers)

The native format is lossless; the interop exports are **lossy**. Everything irreducible
(field/attribute with no native equivalent) is stored in a **marker** (`Marker { format, data }`)
attached to the element — **never silently lost**. The re-export reinjects the marker →
lossless round-trip for the marked data.

| Format         | Export                                | Import                                  |
| -------------- | ------------------------------------- | --------------------------------------- |
| **Excalidraw** | `exportToExcalidraw` / `…String`      | `importFromExcalidraw` (object or JSON) |
| **draw.io**    | `exportToDrawio` (XML `mxGraphModel`) | `importFromDrawio` (XML string)         |

An imported file is an **untrusted input**: zod validation (Excalidraw) / bounded XML parse
without entity resolution (draw.io → no XXE surface), typed `WhiteboardParseError` errors, and
preservation of unknown types/attributes as markers (an unknown Excalidraw type becomes a marked
rectangle rather than disappearing).

For draw.io, the **edges** distinguish `line` and `arrow` by the draw.io style head
(`endArrow=none` without a head → `line`; head present or default style → `arrow`); the export
writes `endArrow=none` (line) / `endArrow=classic` (arrow). Since draw.io has no cell `x`/`y`
field for an edge (its points are absolute), the native `x`/`y` origin is preserved via
dedicated attributes captured into a marker → the `line`/`arrow` round-trip keeps kind, origin
and points.

## React UI (shared editing surface)

Beyond the DOM-free core, the package also exports the **React editing surface**, so a
server-synced host app and the P2P standalone (`processii-standalone`) share **the same code**: a
change to a component immediately benefits both (React in `peerDependencies`).

```tsx
import { WhiteboardEditor, useWhiteboardEngine } from '@binarii/processii';

// From a CrdtDoc (offline-first): mounts the engine then the full surface.
function Surface({ doc, awareness, collaborator }) {
  const engine = useWhiteboardEngine(doc); // memoizes engineFromDoc(doc)
  if (!engine) return null;
  return (
    <WhiteboardEditor engine={engine} awareness={awareness} collaborator={collaborator} editable />
  );
}
```

- **`WhiteboardEditor`** — full-frame surface: `BoardCanvas` (drawing, selection, zoom/pan,
  in-place editing, **in-canvas presence** via `awareness`) + floating `Toolbar` (shape/step
  creation, **background color block**, undo/redo) + contextual `SidePanel` (step/lane
  properties — including the **"Description on the card" toggle** and the **clearable emotion**
  via the "∅ Aucune" option) + contextual style bar. Takes a **shared `engine`**
  (toolbar/canvas/panel act on the same instance); `editable={false}` hides the editing
  controls. The **avatar chips** remain the host app's responsibility (per-app chrome).
- **`useWhiteboardEngine(doc)`** — hook memoizing `engineFromDoc(doc)` (null while `doc` is absent).
- **New items spawn at the viewport center.** `WhiteboardEditor` mirrors the canvas viewport +
  size (`BoardCanvas`'s `onViewportChange`, local presentation state — never persisted) and passes
  the current center down to the `Toolbar` as `getSpawnCenter(): Point | null`. Toolbar shapes
  (rectangle/ellipse/text/sticky/step/sub-process) are then created **centered on what the user is
  looking at**, whatever the pan/zoom, instead of a fixed off-screen corner. Both props are
  optional: a `Toolbar` used standalone (no `getSpawnCenter`, or before the first canvas measure)
  falls back to the historical fixed positions. Groups (metadata) and connectors (geometry-derived)
  are unaffected.
- **Swimlanes are placed context-aware.** The `Toolbar` also takes `getViewRect(): BoundingBox |
null` (the visible world rect, from `visibleWorldRect`) and `onCenterView(world)`. Creating a
  swimlane calls `engine.addSwimlaneInView` (see [Process board](#process-board-process-model)): the
  lane joins the cluster on screen or starts a fresh one centered on the view, then the view
  **recentres onto the new lane** via `onCenterView` — wired to `BoardCanvas`'s
  **`ZoomApi.centerOn(world)`** (pan-only, keeps the zoom). Both props are optional; without them
  the lane falls back to the legacy-block placement and the view does not move.
  > **Hosts composing the primitives directly** (their own layout instead of `WhiteboardEditor`,
  > like the standalone app) must wire this themselves: forward `BoardCanvas`'s `onViewportChange`
  > into a ref and hand `getSpawnCenter`/`getViewRect` (via `viewportCenter`/`visibleWorldRect`) plus
  > `onCenterView` (via `ZoomApi.centerOn`, captured from `onZoomApi`) to the `Toolbar` — otherwise
  > shapes/lanes silently fall back to the fixed/legacy positions.
- Primitives also exported individually (`BoardCanvas`, `Toolbar`, `StylePanel`, `SidePanel`,
  `PresenceAvatars`, **`BoardTypePicker`**, **`ZoomControl`**) + awareness presence helpers
  (`publishCursor`, `publishSelection`, `publishIdentity`, `observePresence`, `readRemoteCursors`,
  `readRemoteSelections`, `readParticipants`, `presenceCssColor`, `initials`) to compose a custom
  layout (what the standalone does).
  - **`BoardTypePicker`** — self-contained board-type selector (process/architecture/idéation): it
    tracks the engine (reflects collab/undo via `board.observe`) and writes via `setBoardType`. Drop
    it anywhere in the host chrome (e.g. a floating bottom bar).
  - **`ZoomControl`** — presentational − / % / + pill. `BoardCanvas` renders one itself **unless
    `hideZoomControl`** is set; a host that wants the zoom in its own layout sets `hideZoomControl`
    and drives an external `ZoomControl` via the actions `BoardCanvas` surfaces through
    **`onZoomApi({ zoomIn, zoomOut, reset, centerOn })`** (the live `%` comes from
    `onViewportChange`; `centerOn(world)` pans to a world point, keeping the zoom).

> **Peer cursors**: rendered as a **colored arrow** (multiplayer style, tip on the exact
> position) + name label, each in **their own color**. The presence color accepts a **semantic
> token** (`accent`, …) **or** a CSS value (hex/rgb/hsl): `presenceCssColor` resolves either
> (`var(--color-<token>)` vs literal). The standalone publishes tokens, the web app a
> deterministic per-user color.

Canvas colors are resolved from the **semantic tokens** read on the active theme (light/dark),
never hard-coded.

## Agent operations (`@binarii/processii/agent-ops`)

A **provider-neutral, headless** catalog of high-level board edits, for a host to expose as tools to
an LLM agent (mapping each to its own function-calling schema). Imported from the **`/agent-ops`**
subpath — DOM-free and **React-free** (server-importable). Each op is
`{ name, description, inputSchema (zod), run(engine, rawInput) }`: `run` validates the input against
`inputSchema` (throws **`AgentOpError`** on invalid) then applies it to a `WhiteboardEngine`. It
reuses the exported domain schema (never redeclares element shapes) and knows nothing about any
specific LLM, host, approval flow or transport.

```ts
import { AGENT_OPS, getAgentOp } from '@binarii/processii/agent-ops';
import { createEngine } from '@binarii/processii';

const engine = createEngine();
getAgentOp('add_step')?.run(engine, { name: 'Validate order', x: 40, y: 20 }); // → { id }
getAgentOp('connect')?.run(engine, { from, to }); // → { id }
getAgentOp('read_board')?.run(engine, {}); // → lossless Scene snapshot
```

First slice: `read_board`, `add_step`, `connect`, `set_board_type`.

## Theming (contract) & `/ui` subpath

**Theming contract.** All styling goes through **semantic CSS variables** `--color-<name>`
(`bg`, `surface`, `surface-raised`, `text`, `muted`, `border`, `accent`, …) — the contract is
the names, not the values. A consumer either imports the **embedded default values** (light/dark
themes, `import '@binarii/processii/styles.css'`) **or** provides its own variables under the
**same names**, and consumes the matching **Tailwind preset** (`tailwindPreset` via `/ui`, or the
`@binarii/processii/tailwind-preset` subpath). A host themes the board by **redefining the
variables** (or by toggling `data-theme='dark'`/`.dark` on `:root`), without recompiling.

If a host already declares these same variables from its own stylesheet, it should **not** also
import `@binarii/processii/styles.css`: both sheets declare the **same variables on the same
selectors** (`:root`, `.dark`, `[data-theme=…]`), so loading both would let the **import order**
decide (last declaration wins) — keep a single sheet.

The list of names (`semanticColorNames`) and the `SemanticColorName` type live in
`src/ui/tokens.ts` (consumed by `render.ts`). Renaming a variable **breaks the contract** — a
semver event, called out in the PR.

**`@binarii/processii/ui` subpath.** Vendored UI primitives (same classes, same tokens):
`Button`, `IconButton`, `Input`, `Textarea`, `Switch`, `Tooltip*`, `Popover*`, `Modal*`,
`AppShell`, `cn` helper, theme runtime helpers `applyTheme` / `getAppliedTheme` /
`getSystemTheme` / `THEME_ATTRIBUTE` (the `data-theme` + `.dark` contract), `LucideIcon`/
`LucideProps` types, plus tokens/themes/preset (`semanticColorNames`, `lightTheme`/`darkTheme`,
`themeCssVarsBlock`, `tailwindPreset`). Used by the package's editing surface and by the
standalone's chrome; typed (`exports` → `dist/ui`).

## Providers (CRDT adapters)

The transport/persistence interfaces live in the package (`src/crdt/providers.ts`) and are the
**contract a host implements**: `TransportProvider`, `PersistenceProvider`,
`TransportProviderFactory`, `PersistenceProviderFactory`, `ConnectionStatus`,
`isTransportProvider`/`isPersistenceProvider` guards. By TS structural typing, a host's own
providers (e.g. y-websocket for server sync, y-indexeddb for persistence, the standalone's
y-webrtc) remain **assignable without adaptation**. The full contract is re-exported by
`src/index.ts`: `CrdtDoc`/`CrdtAwareness` aliases, `createDoc`/`CreateDocOptions`, doc helpers
(`applyUpdate`, `encodeStateAsUpdate`, `syncDocs`, …) and awareness helpers (`createAwareness`,
`destroyAwareness`, `setLocalState`, `getStates`, `onAwarenessChange`, …).

## Public API (excerpt)

```ts
import {
  createEngine,
  engineFromDoc,
  WhiteboardEngine, // engine
  createBoard,
  boardFromDoc, // CRDT board
  parseScene,
  parseElement,
  emptyScene, // model + validation
  renderToCanvas,
  resolveColor, // rendering
  screenToWorld,
  worldToScreen,
  viewportCenter,
  visibleWorldRect,
  panBy,
  zoomAt, // viewport (zoom/pan)
  hitTest,
  elementsInBox,
  boxFromPoints, // hit-testing (click / marquee)
  connectAdapters,
  createMemoryIdentity, // adapters
  exportToDrawio,
  importFromDrawio, // draw.io interop
  exportToExcalidraw,
  importFromExcalidraw, // Excalidraw interop
} from '@binarii/processii';

const engine = createEngine(); // offline, ready
engine.addElement({ kind: 'rectangle', id: 'r1', x: 0, y: 0, width: 120, height: 60 });
engine.moveSelection(10, 0);
const xml = exportToDrawio(engine.toScene());
```

## Dependencies

**No workspace dependency** (self-sufficiency by design). Runtime: `yjs` + `y-protocols`
(CRDT/awareness), `zod` (validation at the boundaries), `lucide-react` (icons), Radix
(`react-popover`/`react-slot`/`react-switch`/`react-tooltip`) + `class-variance-authority`/`clsx`/
`tailwind-merge` (vendored UI primitives). `react`/`react-dom` as **`peerDependencies`**
(provided by the host app) for the React editing surface; the core (scene/board/engine/render…)
stays DOM-free and usable without React. Communication happens **only** through public
interfaces (AGENTS.md).

## How to test

```bash
pnpm --filter @binarii/processii test       # Vitest: scene, board (collab convergence), engine,
                                            #   render, adapters, drawio, excalidraw, crdt/, ui/
pnpm --filter @binarii/processii typecheck  # tsc --noEmit (strict, zero any)
pnpm --filter @binarii/processii lint       # eslint
pnpm --filter @binarii/processii build      # tsc -> dist (also emits dist/ui for the /ui subpath)
```

Coverage: engine operations (add/move/update/remove, single & multi selection), Yjs convergence
of concurrent replicas, export→import round-trip (drawio & excalidraw) with markers, malformed
imports / unknown types (error cases), rendering (primitives + token colors + viewport +
marquee), **viewport** (world↔screen inverses, pan, anchored zoom + bound saturation),
**hit-testing** (rotation-aware click on solid shapes/lines, topmost by z, marquee),
**vendored modules** (`src/crdt/crdt.test.ts`: convergence/offline→resync/awareness/provider
contracts; `src/ui/ui.test.tsx` + `src/ui/theme-css.test.ts`: primitives a11y + tokens ↔
embedded CSS sync).
