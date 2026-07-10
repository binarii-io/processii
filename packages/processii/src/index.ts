/**
 * @binarii/processii — public interface (the only surface other packages may import).
 *
 * **Self-sufficient** package (open source, ADR 0006): engine + rendering of a collaborative,
 * offline-first whiteboard/process board, carried by Yjs (local CRDT helpers, `./crdt/`).
 * Reusable in-app (server sync) and in the P2P standalone (#whiteboard-standalone). Provides:
 *  - lossless native **scene model** (shapes, transforms) + zod validation at the boundaries;
 *  - **CRDT board** (Yjs): add/move/update/remove convergent in collab;
 *  - **engine**: operations + **local selection** + geometry + render model;
 *  - DOM-free 2D Canvas **rendering**, colors via the theming contract's **semantic tokens**
 *    (same CSS variables as ui-kit — zero hard-coded colors);
 *  - pluggable **adapters** (local transport / persistence interfaces + identity);
 *  - re-exported **CRDT/adapters contract** (`CrdtDoc`/`CrdtAwareness` types, providers, helpers);
 *  - drawio & excalidraw **interop export/import**, **lossy + markers** for the irreducible.
 *
 * The vendored UI primitives are exposed via the `@binarii/processii/ui` subpath.
 * Other packages must NEVER import an internal file: everything goes through this module.
 */

// --- Scene model ---
export {
  ELEMENT_KINDS,
  STEP_EMOTIONS,
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
// Types & helpers needed to implement/plug providers (P2P standalone, external consumers):
// structural Yjs aliases, provider interfaces (identical to crdt-core — the memorii providers
// remain assignable), doc & awareness helpers.
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

// --- React UI (editing surface shared by `apps/web` and `apps/whiteboard-standalone`) ---
export {
  WhiteboardEditor,
  useWhiteboardEngine,
  type WhiteboardEditorProps,
  type WhiteboardCollaborator,
} from './editor.js';
export { BoardCanvas, type BoardCanvasProps, type ZoomApi } from './board-canvas.js';
export { Toolbar, type ToolbarProps } from './toolbar.js';
export { BoardTypePicker, type BoardTypePickerProps } from './board-type-picker.js';
export { ZoomControl, type ZoomControlProps } from './zoom-control.js';
export { StylePanel, type StylePanelProps } from './style-panel.js';
export { SidePanel, type SidePanelProps } from './side-panel.js';
export { PresenceAvatars, type PresenceAvatarsProps } from './presence-avatars.js';

// --- Collaborative presence (awareness helpers: cursors, selections, identity, avatars) ---
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
