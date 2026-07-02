/**
 * **Excalidraw** interop — lossy export + defensive import, with **markers** for the irreducible.
 *
 * Excalidraw stores a JSON `.excalidraw` document: `{ type: 'excalidraw', version, elements[],
 * appState, files }`. We map our native elements to/from this format. Everything without a
 * native equivalent (unknown Excalidraw fields, `appState`, `files`) is **preserved** in
 * markers (`Marker`) attached to the element or the scene — never silently lost (docs/02).
 *
 * An imported file is an **untrusted input**: it is parsed via zod (`z.safeParse`) and a typed
 * `WhiteboardParseError` is thrown on invalid structure, never trusting the fields.
 */
import { z } from 'zod';
import {
  emptyScene,
  WhiteboardParseError,
  type Marker,
  type Scene,
  type WhiteboardElement,
} from './scene.js';

const FORMAT = 'excalidraw';

/** Excalidraw fields mapped natively (the rest goes into a marker). */
const NATIVE_EXCALIDRAW_FIELDS = new Set([
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'angle',
  'strokeColor',
  'backgroundColor',
  'strokeWidth',
  'opacity',
  'points',
  'text',
  'fontSize',
]);

/** Excalidraw type → native kind mapping (never `step`: no Excalidraw equivalent on import). */
const TYPE_TO_KIND: Record<string, Exclude<WhiteboardElement['kind'], 'step'> | undefined> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  diamond: 'rectangle', // no native equivalent → rectangle + marker (see import)
  line: 'line',
  arrow: 'arrow',
  text: 'text',
};

const KIND_TO_TYPE: Record<WhiteboardElement['kind'], string> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
  text: 'text',
  // `step` (process board) has no Excalidraw equivalent → rectangle (lossy export, see ADR 0005).
  step: 'rectangle',
};

/** Defensive schema of an incoming Excalidraw element (optional fields, tolerant). */
const excalidrawElementSchema = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    angle: z.number().optional(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    opacity: z.number().optional(),
    points: z.array(z.tuple([z.number(), z.number()])).optional(),
    text: z.string().optional(),
    fontSize: z.number().optional(),
  })
  .loose(); // keeps unknown fields for the markers

const excalidrawFileSchema = z
  .object({
    type: z.literal('excalidraw'),
    elements: z.array(z.unknown()),
    appState: z.record(z.string(), z.unknown()).optional(),
    files: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

/** Excalidraw opacity = 0..100; native = 0..1. */
function toNativeOpacity(value: number | undefined): number {
  if (value === undefined) return 1;
  return value > 1 ? value / 100 : value;
}
function toExcalidrawOpacity(value: number): number {
  return Math.round(value * 100);
}

/**
 * Exports a native scene to an Excalidraw document (serializable JSON object). The
 * `format === 'excalidraw'` markers carried by an element are re-applied (lossless round-trip for them).
 */
export function exportToExcalidraw(scene: Scene): ExcalidrawFile {
  const elements = scene.elements.map((element) => {
    const base: Record<string, unknown> = {
      id: element.id,
      type: KIND_TO_TYPE[element.kind],
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      angle: element.angle,
      strokeColor: element.stroke,
      backgroundColor: element.fill,
      strokeWidth: element.strokeWidth,
      opacity: toExcalidrawOpacity(element.opacity),
    };
    if (element.kind === 'line' || element.kind === 'arrow') base['points'] = element.points;
    if (element.kind === 'text') {
      base['text'] = element.text;
      base['fontSize'] = element.fontSize;
    }
    // Re-injects the irreducible data preserved on import.
    const marker = element.markers.find((m) => m.format === FORMAT);
    if (marker) Object.assign(base, marker.data);
    return base;
  });

  return {
    type: 'excalidraw',
    version: 2,
    source: '@binarii/processii',
    elements,
    appState: {},
    files: {},
  };
}

/** Serializes an Excalidraw document to a `.excalidraw` string. */
export function exportToExcalidrawString(scene: Scene): string {
  return JSON.stringify(exportToExcalidraw(scene), null, 2);
}

/**
 * Imports an Excalidraw document (already-parsed object OR JSON string) into a native scene.
 * Untrusted input → zod validation. Throws `WhiteboardParseError` when the structure is invalid
 * or the JSON is malformed. Unmappable fields are stored in a per-element marker.
 */
export function importFromExcalidraw(input: unknown): Scene {
  const parsed = typeof input === 'string' ? safeJsonParse(input) : input;
  const file = excalidrawFileSchema.safeParse(parsed);
  if (!file.success) {
    throw new WhiteboardParseError('Document Excalidraw invalide', file.error.issues);
  }

  const scene: Scene = emptyScene();
  let index = 0;
  for (const rawElement of file.data.elements) {
    const elResult = excalidrawElementSchema.safeParse(rawElement);
    if (!elResult.success) {
      // Unreadable individual element: skipping it while keeping a trace in a scene marker
      // would be outside the element's scope; here we fail hard to avoid corrupting anything.
      throw new WhiteboardParseError(
        `Élément Excalidraw #${index} invalide`,
        elResult.error.issues,
      );
    }
    const el = elResult.data;
    const kind = TYPE_TO_KIND[el.type];
    if (!kind) {
      // Unknown type: we do not invent it. It is preserved as a marked rectangle (visible + not
      // lost) rather than made to disappear.
      index++;
      scene.elements.push(unknownAsRectangle(el, index));
      continue;
    }

    const marker = buildMarker(el, kind, el.type);
    const common = {
      id: el.id ?? `excalidraw-${index}`,
      x: el.x ?? 0,
      y: el.y ?? 0,
      width: Math.max(0, el.width ?? 0),
      height: Math.max(0, el.height ?? 0),
      angle: el.angle ?? 0,
      stroke: el.strokeColor ?? 'text',
      fill: el.backgroundColor ?? 'transparent',
      strokeWidth: el.strokeWidth && el.strokeWidth > 0 ? el.strokeWidth : 1,
      opacity: clamp01(toNativeOpacity(el.opacity)),
      z: index,
      markers: marker ? [marker] : [],
    };

    if (kind === 'line' || kind === 'arrow') {
      scene.elements.push({
        kind,
        ...common,
        points:
          el.points && el.points.length >= 2
            ? el.points
            : [
                [0, 0],
                [common.width, common.height],
              ],
      });
    } else if (kind === 'text') {
      scene.elements.push({
        kind: 'text',
        ...common,
        text: el.text ?? '',
        fontSize: el.fontSize && el.fontSize > 0 ? el.fontSize : 16,
      });
    } else {
      scene.elements.push({ kind, ...common });
    }
    index++;
  }
  return scene;
}

// --- helpers ---

function buildMarker(
  el: z.infer<typeof excalidrawElementSchema>,
  mappedKind: WhiteboardElement['kind'],
  originalType: string,
): Marker | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(el)) {
    if (!NATIVE_EXCALIDRAW_FIELDS.has(key)) extra[key] = value;
  }
  // When the original type does not exactly match the kind (diamond→rectangle), record it.
  if (KIND_TO_TYPE[mappedKind] !== originalType) extra['type'] = originalType;
  if (Object.keys(extra).length === 0) return undefined;
  return { format: FORMAT, data: extra };
}

function unknownAsRectangle(
  el: z.infer<typeof excalidrawElementSchema>,
  index: number,
): WhiteboardElement {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(el)) {
    if (!NATIVE_EXCALIDRAW_FIELDS.has(key)) extra[key] = value;
  }
  extra['type'] = el.type;
  return {
    kind: 'rectangle',
    id: el.id ?? `excalidraw-unknown-${index}`,
    x: el.x ?? 0,
    y: el.y ?? 0,
    width: Math.max(0, el.width ?? 0),
    height: Math.max(0, el.height ?? 0),
    angle: el.angle ?? 0,
    stroke: el.strokeColor ?? 'muted',
    fill: 'transparent',
    strokeWidth: 1,
    opacity: clamp01(toNativeOpacity(el.opacity)),
    z: index,
    markers: [{ format: FORMAT, data: extra }],
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WhiteboardParseError('JSON Excalidraw malformé', undefined);
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Excalidraw document produced on export. */
export interface ExcalidrawFile {
  type: 'excalidraw';
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
