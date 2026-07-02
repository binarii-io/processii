/**
 * **draw.io / diagrams.net** interop — lossy export + defensive import with **markers**.
 *
 * draw.io serializes an XML `mxGraphModel`: a `<root>` of `<mxCell>`; each "vertex" cell
 * carries an `<mxGeometry x y width height />` and a `style` attribute (;-separated key=value).
 * We map our native elements to/from this format. Everything irreducible (full draw.io style,
 * unknown attributes) is **preserved** in a marker (`format: 'drawio'`) attached to the element,
 * enabling a lossless native → drawio → native round-trip for the marked data (docs/02).
 *
 * An imported file is **untrusted**: bounded home-made XML parse (no external entities, no
 * DTD), number validation, typed `WhiteboardParseError` errors. No execution, no network
 * entity resolution → no XXE surface.
 */
import {
  emptyScene,
  WhiteboardParseError,
  type Marker,
  type Scene,
  type WhiteboardElement,
} from './scene.js';

const FORMAT = 'drawio';

/** Native kind → draw.io shape (base `shape`/style key). */
function kindToStyle(element: WhiteboardElement): string {
  switch (element.kind) {
    case 'rectangle':
      return 'rounded=0;whiteSpace=wrap;html=1;';
    case 'ellipse':
      return 'ellipse;whiteSpace=wrap;html=1;';
    case 'text':
      return 'text;html=1;align=left;verticalAlign=top;';
    case 'step':
      // Process board node → rounded rectangle (lossy export, see ADR 0005).
      return 'rounded=1;whiteSpace=wrap;html=1;';
    case 'line':
      // Headless edge: draw.io distinguishes line vs arrow via `endArrow`.
      return 'edgeStyle=none;html=1;endArrow=none;';
    case 'arrow':
      return 'edgeStyle=none;html=1;endArrow=classic;';
  }
}

/**
 * Export marker preserving the native origin of an edge (`x`/`y`). draw.io stores an edge's
 * points in absolute coordinates (`<mxPoint>`), with no cell `x`/`y` field; without a marker,
 * the native → drawio → native round-trip would lose the origin (`x`/`y`) and reset it to 0.
 * The native origin is therefore stored in the `format: 'drawio'` marker for a lossless round-trip.
 */
const EDGE_ORIGIN_X = 'nativeX';
const EDGE_ORIGIN_Y = 'nativeY';

/**
 * Exports a native scene to a draw.io XML string (`mxGraphModel`). Reinjects the original
 * draw.io style when present in a marker (round-trip).
 */
export function exportToDrawio(scene: Scene): string {
  const cells: string[] = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />'];
  for (const element of scene.elements) {
    const marker = element.markers.find((m) => m.format === FORMAT);
    const style =
      typeof marker?.data['style'] === 'string' ? marker.data['style'] : buildStyle(element);
    const isEdge = element.kind === 'line' || element.kind === 'arrow';
    const value =
      element.kind === 'text'
        ? escapeXml(element.text)
        : element.kind === 'step'
          ? escapeXml(element.name)
          : '';
    // For an edge, draw.io has no cell x/y field: the native origin is preserved via dedicated
    // attributes (captured into a marker on import) → lossless x/y round-trip.
    const originAttrs = isEdge
      ? ` ${EDGE_ORIGIN_X}="${num(element.x)}" ${EDGE_ORIGIN_Y}="${num(element.y)}"`
      : '';
    const geom = isEdge
      ? `<mxGeometry relative="1" as="geometry"><Array as="points">${pointsXml(element)}</Array></mxGeometry>`
      : `<mxGeometry x="${num(element.x)}" y="${num(element.y)}" width="${num(element.width)}" height="${num(element.height)}" as="geometry" />`;
    cells.push(
      `<mxCell id="${escapeXml(element.id)}" value="${value}" style="${escapeXml(style)}"${originAttrs} ${isEdge ? 'edge="1"' : 'vertex="1"'} parent="1">${geom}</mxCell>`,
    );
  }
  return `<mxGraphModel><root>${cells.join('')}</root></mxGraphModel>`;
}

/**
 * Imports a draw.io XML string into a native scene. Untrusted input → bounded parse + typed
 * errors. Each cell keeps its raw `style` and its unmapped attributes in a marker.
 */
export function importFromDrawio(input: unknown): Scene {
  if (typeof input !== 'string') {
    throw new WhiteboardParseError('Entrée draw.io attendue : chaîne XML');
  }
  const cells = parseMxCells(input);
  const scene: Scene = emptyScene();
  let index = 0;
  for (const cell of cells) {
    if (cell.id === '0' || cell.id === '1') continue; // technical root cells
    const isVertex = cell.attrs['vertex'] === '1';
    const isEdge = cell.attrs['edge'] === '1';
    if (!isVertex && !isEdge) continue; // neither shape nor link → skipped (group/root)

    const style = cell.attrs['style'] ?? '';
    const kind = styleToKind(style, isEdge);
    const geom = cell.geometry;

    // Native edge origin preserved at export (otherwise 0: draw.io has no cell x/y for an
    // edge). Removed from the unmapped attrs to avoid duplicating it in the marker.
    const originX = toNum(cell.attrs[EDGE_ORIGIN_X]);
    const originY = toNum(cell.attrs[EDGE_ORIGIN_Y]);

    const extra: Record<string, unknown> = { style };
    for (const [key, value] of Object.entries(cell.attrs)) {
      if (NATIVE_DRAWIO_ATTRS.has(key)) continue;
      if (key === EDGE_ORIGIN_X || key === EDGE_ORIGIN_Y) continue;
      extra[key] = value;
    }
    const marker: Marker = { format: FORMAT, data: extra };

    const edgeX = isEdge ? (originX ?? 0) : (geom?.x ?? 0);
    const edgeY = isEdge ? (originY ?? 0) : (geom?.y ?? 0);

    const common = {
      id: cell.id || `drawio-${index}`,
      x: edgeX,
      y: edgeY,
      width: Math.max(0, geom?.width ?? (isEdge ? 0 : 120)),
      height: Math.max(0, geom?.height ?? (isEdge ? 0 : 60)),
      angle: 0,
      stroke: 'text',
      fill: kind === 'text' ? 'transparent' : 'transparent',
      strokeWidth: 1,
      opacity: 1,
      z: index,
      markers: [marker],
    };

    if (kind === 'line' || kind === 'arrow') {
      // draw.io points are absolute; the native format stores them relative to (x, y).
      const points: [number, number][] =
        geom?.points && geom.points.length >= 2
          ? geom.points.map(([px, py]) => [px - edgeX, py - edgeY] as [number, number])
          : [[0, 0] as [number, number], [common.width || 100, 0] as [number, number]];
      scene.elements.push({ kind, ...common, points });
    } else if (kind === 'text') {
      scene.elements.push({
        kind: 'text',
        ...common,
        text: cell.attrs['value'] ?? '',
        fontSize: 16,
      });
    } else {
      scene.elements.push({ kind, ...common });
    }
    index++;
  }
  return scene;
}

// --- style mapping ---

const NATIVE_DRAWIO_ATTRS = new Set(['id', 'parent', 'vertex', 'edge', 'value', 'style']);

function buildStyle(element: WhiteboardElement): string {
  return kindToStyle(element);
}

function styleToKind(style: string, isEdge: boolean): Exclude<WhiteboardElement['kind'], 'step'> {
  const tokens = style.split(';').map((t) => t.trim().toLowerCase());
  if (isEdge) {
    // draw.io distinguishes line and arrow by the head. By default draw.io draws an arrow
    // (`endArrow=classic`). An edge is a **line** only when no head is drawn:
    // `endArrow=none` AND (`startArrow` absent or `none`). Any remaining head → arrow.
    const endArrow = styleValue(tokens, 'endarrow');
    const startArrow = styleValue(tokens, 'startarrow');
    const endHead = endArrow !== undefined && endArrow !== 'none';
    const startHead = startArrow !== undefined && startArrow !== 'none';
    if (endArrow === 'none' && !startHead) return 'line';
    return endHead || startHead || endArrow === undefined ? 'arrow' : 'line';
  }
  if (tokens.includes('ellipse')) return 'ellipse';
  if (tokens.includes('text') || tokens.some((t) => t.startsWith('text'))) return 'text';
  return 'rectangle';
}

/** Reads the value of a `key=value` key in draw.io style tokens (already lowercased). */
function styleValue(tokens: string[], key: string): string | undefined {
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq === -1) continue;
    if (token.slice(0, eq) === key) return token.slice(eq + 1);
  }
  return undefined;
}

function pointsXml(element: WhiteboardElement): string {
  if (element.kind !== 'line' && element.kind !== 'arrow') return '';
  return element.points
    .map(([px, py]) => `<mxPoint x="${num(element.x + px)}" y="${num(element.y + py)}" />`)
    .join('');
}

// --- bounded mini XML parser (mxGraphModel subset) ---

interface DrawioGeometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: [number, number][];
}
interface DrawioCell {
  id: string;
  attrs: Record<string, string>;
  geometry?: DrawioGeometry;
}

/**
 * Extracts the `<mxCell>` and their `<mxGeometry>` from a draw.io XML, without an XML library
 * (hence no external-entity risk). Tolerates whitespace/quote variations. Throws when no
 * `mxGraphModel` or root is found (non-draw.io structure).
 */
function parseMxCells(xml: string): DrawioCell[] {
  if (!/<mxGraphModel[\s>]/i.test(xml) && !/<mxCell[\s>]/i.test(xml)) {
    throw new WhiteboardParseError('XML draw.io invalide : ni mxGraphModel ni mxCell');
  }
  const cells: DrawioCell[] = [];
  // Captures each mxCell (self-closing OR with geometry content).
  const cellRegex = /<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(xml)) !== null) {
    const attrsRaw = match[1] ?? '';
    const inner = match[3] ?? '';
    const attrs = parseAttrs(attrsRaw);
    const id = attrs['id'];
    if (id === undefined) continue; // cell without id → skipped (non-conforming)
    const cell: DrawioCell = { id, attrs };
    const geom = parseGeometry(inner);
    if (geom) cell.geometry = geom;
    cells.push(cell);
  }
  if (cells.length === 0) {
    throw new WhiteboardParseError('XML draw.io invalide : aucune mxCell exploitable');
  }
  return cells;
}

function parseGeometry(inner: string): DrawioGeometry | undefined {
  const geomMatch = /<mxGeometry\b([^>]*?)(\/>|>([\s\S]*?)<\/mxGeometry>)/i.exec(inner);
  if (!geomMatch) return undefined;
  const attrs = parseAttrs(geomMatch[1] ?? '');
  const geom: DrawioGeometry = {};
  const x = toNum(attrs['x']);
  const y = toNum(attrs['y']);
  const w = toNum(attrs['width']);
  const h = toNum(attrs['height']);
  if (x !== undefined) geom.x = x;
  if (y !== undefined) geom.y = y;
  if (w !== undefined) geom.width = w;
  if (h !== undefined) geom.height = h;
  const pointsInner = geomMatch[3] ?? '';
  const points: [number, number][] = [];
  const pointRegex = /<mxPoint\b([^>]*?)\/?>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pointRegex.exec(pointsInner)) !== null) {
    const pa = parseAttrs(pm[1] ?? '');
    const px = toNum(pa['x']);
    const py = toNum(pa['y']);
    if (px !== undefined && py !== undefined) points.push([px, py]);
  }
  if (points.length > 0) geom.points = points;
  return geom;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(raw)) !== null) {
    const key = m[1];
    const value = m[2];
    if (key !== undefined && value !== undefined) attrs[key] = unescapeXml(value);
  }
  return attrs;
}

function toNum(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
