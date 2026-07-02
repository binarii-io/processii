/**
 * Whiteboard scene model — **portable and offline-first**.
 *
 * A scene is a flat set of "elements" (shapes/text/lines) addressed by id. It is the native
 * **lossless** format (the "save"): anything without an equivalent in an interop export
 * (drawio/excalidraw) remains representable here. The model is intentionally independent of the
 * storage engine (Yjs) and of the rendering: these types describe the logical state, the Yjs
 * binding (`board.ts`) and the renderers (`render.ts`) consume this vocabulary.
 *
 * Every input boundary (drawio/excalidraw import, deserialization) goes through the zod schemas
 * below: an element that is not valid never enters a scene.
 */
import { z } from 'zod';

/**
 * Native element kinds supported by the engine. `step` is the **process board node** (rich-content
 * card); the shapes (`rectangle`/`ellipse`/`line`/`arrow`/`text`) remain available as
 * annotations. Swimlanes and groups are **not** elements: they are separate collections
 * (see `swimlaneSchema` / `agentGroupSchema`).
 */
export const ELEMENT_KINDS = ['rectangle', 'ellipse', 'line', 'arrow', 'text', 'step'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Optional subjective indicator on a step (badge). */
export const STEP_EMOTIONS = ['happy', 'neutral', 'sad'] as const;
export type StepEmotion = (typeof STEP_EMOTIONS)[number];

/**
 * Interop irreducibility marker: when an export (drawio/excalidraw) or an import loses
 * information for lack of an equivalent, we **never let it disappear silently** — it is stored
 * in a marker attached to the element (see docs/02 "interop vs native"). The
 * native → interop → native round-trip then stays lossless for the marked data.
 */
export const markerSchema = z.object({
  /** Source/target format of the marker (e.g. 'drawio', 'excalidraw'). */
  format: z.string().min(1),
  /** Opaque payload kept as-is (unmappable attributes). JSON-serializable. */
  data: z.record(z.string(), z.unknown()),
});
export type Marker = z.infer<typeof markerSchema>;

/** Color: reference to a ui-kit semantic token OR a free value (external import). */
export const colorSchema = z.string().min(1);

/** Positional bounds common to all elements (top-left corner + dimensions). */
const baseGeometry = {
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  /** Rotation in radians around the center. */
  angle: z.number().finite().default(0),
};

const baseStyle = {
  /** ui-kit semantic token (e.g. 'text', 'accent') or imported free color. */
  stroke: colorSchema.default('text'),
  fill: colorSchema.default('transparent'),
  strokeWidth: z.number().finite().positive().default(1),
  /** Stroke style: solid (default) or dashed. Absent = solid. */
  strokeDash: z.enum(['solid', 'dashed']).optional(),
  opacity: z.number().min(0).max(1).default(1),
};

const elementCommon = {
  id: z.string().min(1),
  ...baseGeometry,
  ...baseStyle,
  /** Z-order: render order, higher = on top. */
  z: z.number().finite().default(0),
  /** Interop markers (preserved irreducibles). Empty for a purely native element. */
  markers: z.array(markerSchema).default([]),
};

/**
 * **Per-element text format** (#82): alignment + style, applied to **all** of the item's text
 * (no per-character rich text on canvas). Shared by the text-bearing elements
 * (`text`, `step`, `rectangle`, `ellipse`). All optional: absent = kind-dependent default at render.
 */
const textFormat = {
  /** **Horizontal** text alignment. Render default: `left` for `text`, `center` otherwise. */
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  /** Strikethrough. */
  strike: z.boolean().optional(),
  /** Font size (world px). Kind-dependent render default when absent. */
  fontSize: z.number().finite().positive().optional(),
};

// Basic shapes: common geometry + style, plus an optional centered **text label** (edited on
// double-click, like a step; empty by default → bare shape). Native field (lossless save).
export const rectangleSchema = z.object({
  kind: z.literal('rectangle'),
  ...elementCommon,
  text: z.string().optional(),
  ...textFormat,
  /** "Card" drop shadow. Absent = **enabled** (default); `false` disables it. */
  shadow: z.boolean().optional(),
});
export const ellipseSchema = z.object({
  kind: z.literal('ellipse'),
  ...elementCommon,
  text: z.string().optional(),
  ...textFormat,
  shadow: z.boolean().optional(),
});

/**
 * Optional links of a connector (line/arrow) to elements: when `start`/`end` reference a present
 * id, the `points` are **recomputed** (re-routed) when the linked element moves/resizes
 * (`engine.refreshConnectors`). **Native** fields: kept in the lossless save, ignored by the
 * interop exports (lossy).
 */
/** Possible anchor sides of a connector on a box (North/East/South/West). */
export const CONNECTOR_SIDES = ['n', 'e', 's', 'w'] as const;
export type ConnectorSide = (typeof CONNECTOR_SIDES)[number];

const connectorBindings = {
  start: z.string().min(1).optional(),
  end: z.string().min(1).optional(),
  /**
   * **Pinned** anchor sides (optional): when present, the connector exits/enters through this
   * exact side (allows e.g. a top→top loop). Absent → side facing the other box (auto).
   */
  startSide: z.enum(CONNECTOR_SIDES).optional(),
  endSide: z.enum(CONNECTOR_SIDES).optional(),
  /** Arrowheads at the ends (optional; absent = none → plain line). */
  startArrow: z.boolean().optional(),
  endArrow: z.boolean().optional(),
  /**
   * **Manual** elbow position (crossing segment) in **world** coordinate: the middle segment is
   * moved perpendicularly (up/down when horizontal, left/right when vertical). The affected
   * **axis** is derived from the routing (see `connectorElbow`). Absent = **auto-centered**
   * elbow (default behavior). **Native** field (lossless save), ignored by interop.
   */
  midpoint: z.number().finite().optional(),
};

export const lineSchema = z.object({
  kind: z.literal('line'),
  ...elementCommon,
  ...connectorBindings,
  /** Points relative to (x, y). At least 2. */
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2),
});

export const arrowSchema = z.object({
  kind: z.literal('arrow'),
  ...elementCommon,
  ...connectorBindings,
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2),
});

export const textSchema = z.object({
  kind: z.literal('text'),
  ...elementCommon,
  ...textFormat,
  text: z.string(),
  // `text` historically has a default size (16) — we keep that default (overrides `textFormat`).
  fontSize: z.number().finite().positive().default(16),
  /** Sticky drop shadow (filled text). Absent = enabled (default); `false` disables it. */
  shadow: z.boolean().optional(),
});

/**
 * `step` — **process board** node: a positioned card (box) with rich content. Reuses all the
 * common geometry/style (hence bounds, hit-test, handles, selection, move). The
 * `skills`/`deliverables` labels are **free-form** (no registry — adaptation, see ADR 0005).
 * `swimlaneId` (optionally) attaches the step to a lane.
 */
export const stepSchema = z.object({
  kind: z.literal('step'),
  ...elementCommon,
  // "Card" default of an item: **white background** (`surface`) and **no outline** (overrides
  // baseStyle, whose `transparent`/`text` defaults suit bare shapes but not a step).
  fill: colorSchema.default('surface'),
  stroke: colorSchema.default('transparent'),
  ...textFormat,
  name: z.string().default(''),
  description: z.string().default(''),
  /** Shows (or not) the description on the card. Absent/`false` = hidden (default). */
  showDescription: z.boolean().optional(),
  skills: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  emotion: z.enum(STEP_EMOTIONS).optional(),
  /** "Card" drop shadow. Absent = **enabled** (default, like rectangle/ellipse); `false` disables it. */
  shadow: z.boolean().optional(),
  swimlaneId: z.string().optional(),
  /**
   * **Sub-process**: **opaque** id of a child whiteboard document linked to this step (the
   * "enter it" navigation is handled by the host app, which alone knows the document notion).
   * Native field (lossless save); ignored by interop. The package does not interpret it — it
   * displays it (badge) and surfaces a double-click via `onNavigateSubprocess`.
   */
  subprocessRef: z.string().min(1).optional(),
});

/** Discriminated schema of any scene element. */
export const elementSchema = z.discriminatedUnion('kind', [
  rectangleSchema,
  ellipseSchema,
  lineSchema,
  arrowSchema,
  textSchema,
  stepSchema,
]);
export type WhiteboardElement = z.infer<typeof elementSchema>;

/** Semantic colors of a swimlane (mapped to ui-kit tokens at render time). */
export const SWIMLANE_COLORS = [
  'blue',
  'green',
  'orange',
  'red',
  'purple',
  'yellow',
  'neutral',
] as const;
export type SwimlaneColor = (typeof SWIMLANE_COLORS)[number];

/**
 * Swimlane — horizontal organizational band of the process board. Separate collection (not an
 * element): ordered (`order`), own height, width shared at scene level (`swimlanesWidth`).
 */
export const swimlaneSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  /** Lane category (actor/system/free). Named `laneType` to avoid any confusion. */
  laneType: z.enum(['user', 'system', 'custom']).default('custom'),
  /** Free type label when `laneType === 'custom'` (otherwise ignored). */
  customType: z.string().optional(),
  color: z.enum(SWIMLANE_COLORS).default('neutral'),
  /** 0-based vertical order. */
  order: z.number().int().nonnegative().default(0),
  /** Height in world units. */
  height: z.number().finite().positive().default(160),
});
export type Swimlane = z.infer<typeof swimlaneSchema>;

/**
 * Group — **generic named** grouping of steps (e.g. "agent"). Separate collection. A step
 * can belong to at most one group (invariant held by the caller / the engine).
 */
export const agentGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  stepIds: z.array(z.string()).default([]),
});
export type AgentGroup = z.infer<typeof agentGroupSchema>;

/** Shared width (world units) of all swimlanes. */
export const DEFAULT_SWIMLANES_WIDTH = 2000;

/** A complete scene (lossless native format), JSON-serializable. */
export const sceneSchema = z.object({
  /** Native format version (for future migrations). */
  version: z.literal(1).default(1),
  elements: z.array(elementSchema),
  /** Process board lanes (empty for a simple shape whiteboard). */
  swimlanes: z.array(swimlaneSchema).default([]),
  /** Shared lane width. */
  swimlanesWidth: z.number().finite().positive().default(DEFAULT_SWIMLANES_WIDTH),
  /** Named step groupings. */
  agentGroups: z.array(agentGroupSchema).default([]),
  /** Board background color (ui-kit token or CSS literal); absent = theme default. */
  background: z.string().min(1).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

/** Typed scene/import validation error. */
export class WhiteboardParseError extends Error {
  override readonly name = 'WhiteboardParseError';
  constructor(
    message: string,
    readonly issues?: readonly z.core.$ZodIssue[],
  ) {
    super(message);
  }
}

/**
 * Validates an unknown object as a scene element. Throws a typed `WhiteboardParseError` when
 * invalid. Applies the default values (style, markers, z, angle…), hence returns a complete element.
 */
export function parseElement(input: unknown): WhiteboardElement {
  const result = elementSchema.safeParse(input);
  if (!result.success) {
    throw new WhiteboardParseError('Élément de whiteboard invalide', result.error.issues);
  }
  return result.data;
}

/** Validates a complete scene (untrusted input). Throws `WhiteboardParseError` when invalid. */
export function parseScene(input: unknown): Scene {
  const result = sceneSchema.safeParse(input);
  if (!result.success) {
    throw new WhiteboardParseError('Scène de whiteboard invalide', result.error.issues);
  }
  return result.data;
}

/** Creates a valid empty scene. */
export function emptyScene(): Scene {
  return {
    version: 1,
    elements: [],
    swimlanes: [],
    swimlanesWidth: DEFAULT_SWIMLANES_WIDTH,
    agentGroups: [],
  };
}
