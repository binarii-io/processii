/**
 * @binarii/processii/core — the **React-free** core of the package (the `@binarii/processii/core`
 * subpath, ADR: 0.7.0).
 *
 * A **headless** surface: everything a **Node backend** needs to build a board/engine from a Y.Doc
 * and mutate it (e.g. to apply the `@binarii/processii/agent-ops` server-side), with **zero React**.
 * The main entry (`.`) re-exports this same core **and** the React editing surface (editor, canvas,
 * toolbar, hooks…), so `import … from '@binarii/processii'` transitively pulls React — unusable on a
 * server. This subpath re-exports **only** the DOM-free / React-free modules (scene, board, engine,
 * render, viewport, hit-test, handles, snap, history, connector, adapters, CRDT helpers, presence,
 * excalidraw/draw.io interop), so it stays importable from a pure Node runtime where `react` is not
 * even resolvable.
 *
 * It is a **strict subset** of `./index.ts`: the exports below are identical (same names, same
 * modules) to the DOM-free part of the main barrel — the React UI block is the only thing left out.
 * `@binarii/processii/agent-ops` runs its `run(engine, …)` against a {@link WhiteboardEngine} built
 * here (`engineFromDoc` / `createEngine`), closing the "how does a server obtain an engine?" gap.
 */

// --- Scene model ---
export {
  ELEMENT_KINDS,
  STEP_EMOTIONS,
  SUBPROCESS_KINDS,
  BOARD_TYPES,
  SWIMLANE_COLORS,
  CONNECTOR_SIDES,
  DEFAULT_SWIMLANES_WIDTH,
  LEGACY_CLUSTER_ID,
  elementSchema,
  stepSchema,
  swimlaneSchema,
  swimlaneClusterSchema,
  agentGroupSchema,
  sceneSchema,
  markerSchema,
  parseElement,
  parseScene,
  emptyScene,
  WhiteboardParseError,
  WhiteboardSchemaVersionError,
  type ElementKind,
  type StepEmotion,
  type SubprocessKind,
  type BoardType,
  type SwimlaneColor,
  type ConnectorSide,
  type WhiteboardElement,
  type Swimlane,
  type SwimlaneCluster,
  type AgentGroup,
  type Scene,
  type Marker,
} from './scene.js';

// --- CRDT board (Yjs) ---
export {
  WhiteboardBoard,
  createBoard,
  boardFromDoc,
  DOC_SCHEMA_VERSION,
  type ElementPatch,
} from './board.js';

// --- Engine + rendering (model) ---
export {
  WhiteboardEngine,
  createEngine,
  engineFromDoc,
  elementBounds,
  type BoundingBox,
  type RenderItem,
  type RenderModel,
} from './engine.js';

// --- 2D Canvas rendering ---
// DOM-free: draws onto any `CanvasLike` (a `CanvasRenderingContext2D` in the browser, or a headless
// 2D context in Node — e.g. `node-canvas`). No `react`/`react-dom`, no `document`/`window`.
export {
  renderToCanvas,
  resolveColor,
  isColorToken,
  SELECTION_COLOR,
  LANE_PALETTE,
  type CanvasLike,
  type ColorResolver,
  type RenderOptions,
} from './render.js';

// --- Viewport (zoom/pan, local presentation state) ---
export {
  IDENTITY_VIEWPORT,
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  screenToWorld,
  worldToScreen,
  viewportCenter,
  visibleWorldRect,
  panBy,
  zoomAt,
  setZoom,
  type Viewport,
  type Point,
  type Size,
} from './viewport.js';

// --- Hit-testing (click / marquee selection) ---
export {
  DEFAULT_HIT_TOLERANCE,
  pointInElement,
  hitTest,
  elementsInBox,
  boxFromPoints,
} from './hit-test.js';

// --- Transform handles (resize + rotation) ---
export {
  HANDLE_SCREEN_SIZE,
  ROTATE_HANDLE_OFFSET,
  MIN_ELEMENT_SIZE,
  hasHandles,
  elementHandles,
  handleAtPoint,
  resizeElement,
  rotateElement,
  type Handle,
  type HandleKind,
} from './handles.js';

// --- Snapping / alignment ---
export { snapMove, type SnapResult } from './snap.js';

// --- History (undo/redo) ---
export { wrapUndoManager, type WhiteboardHistory } from './history.js';

// --- Bound connectors (edge-to-edge routing) ---
export { connectorGeometry, borderPoint } from './connector.js';

// --- Pluggable adapters ---
export {
  connectAdapters,
  createMemoryIdentity,
  participantSchema,
  WhiteboardAdapterError,
  type Participant,
  type IdentityAdapter,
  type WhiteboardAdapters,
  type WhiteboardSession,
} from './adapters.js';

// --- CRDT / adapters contract (local `./crdt/` module, vendored from crdt-core — ADR 0006) ---
// Types & helpers needed to implement/plug providers (P2P standalone, external consumers, a server
// host): structural Yjs aliases (`CrdtDoc = Y.Doc`, so a raw `new Y.Doc()` is accepted by
// `engineFromDoc`), provider interfaces, doc & awareness helpers.
export {
  // Documents
  createDoc,
  encodeStateAsUpdate,
  encodeStateVector,
  diffUpdate,
  applyUpdate,
  mergeUpdates,
  onUpdate,
  syncDocs,
  type CrdtDoc,
  type CrdtUpdate,
  type CrdtStateVector,
  type CreateDocOptions,
  // Awareness (presence)
  createAwareness,
  setLocalState,
  getLocalState,
  clearLocalState,
  getStates,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  onAwarenessChange,
  destroyAwareness,
  type CrdtAwareness,
  type AwarenessUpdate,
  type AwarenessChange,
  // Providers (pluggable transport / persistence)
  isTransportProvider,
  isPersistenceProvider,
  type CrdtProvider,
  type TransportProvider,
  type PersistenceProvider,
  type ConnectionStatus,
  type TransportProviderFactory,
  type PersistenceProviderFactory,
} from './crdt/index.js';

// --- Excalidraw interop ---
export {
  exportToExcalidraw,
  exportToExcalidrawString,
  importFromExcalidraw,
  type ExcalidrawFile,
} from './excalidraw.js';

// --- draw.io interop ---
export { exportToDrawio, importFromDrawio } from './drawio.js';

// --- Collaborative presence (awareness helpers: cursors, selections, identity) ---
// React-free (pure awareness helpers over `CrdtAwareness`). The React `PresenceAvatars` component
// is NOT here — it stays on the main `.` entry only.
export {
  publishCursor,
  publishSelection,
  publishIdentity,
  observePresence,
  readRemoteCursors,
  readRemoteSelections,
  readParticipants,
  presenceCssColor,
  initials,
  type RemoteCursor,
  type RemoteSelection,
  type PresenceParticipant,
} from './presence.js';
