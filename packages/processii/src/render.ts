/**
 * Whiteboard rendering — **DOM-free at its core**, target-agnostic.
 *
 * The engine exposes a `RenderModel` (sorted elements + selection state + bounds). Here we provide:
 * - a color resolver mapping the **ui-kit semantic tokens** to CSS variables
 *   (`var(--color-<token>)`) — **zero hard-coded colors** natively; a free value (coming from an
 *   external import) passes through unchanged;
 * - a **2D Canvas** renderer drawing on any `CanvasLike` (the real DOM
 *   `CanvasRenderingContext2D`, or a test double). The engine therefore has no DOM dependency.
 *
 * Why no literal colors: docs/08 — components only know the semantic vocabulary; the actual value
 * comes from the active theme (light/dark) via the CSS variables of the **theming contract**
 * (same names as ui-kit — vendored in `./ui/tokens.ts`, ADR 0006).
 */
import { semanticColorNames, type SemanticColorName } from './ui/tokens.js';
import type {
  BoundingBox,
  RenderAgentGroup,
  RenderItem,
  RenderModel,
  RenderSwimlane,
} from './engine.js';
import { IDENTITY_VIEWPORT, type Viewport } from './viewport.js';
import { elementHandles, hasHandles, HANDLE_SCREEN_SIZE } from './handles.js';

const TOKEN_SET: ReadonlySet<string> = new Set<string>(semanticColorNames);

/**
 * Resolves an element color into a drawable value:
 * - `'transparent'` → `'transparent'` (no fill);
 * - a known ui-kit semantic token → `var(--color-<token>)` (follows the active theme);
 * - any other value (drawio/excalidraw imported color: `#rrggbb`, `rgb(...)`) → unchanged.
 */
export function resolveColor(value: string): string {
  if (value === 'transparent' || value === 'none') return 'transparent';
  if (TOKEN_SET.has(value)) return `var(--color-${value})`;
  return value;
}

/**
 * Token → **drawable** color resolver. `resolveColor` (CSS variables) works for DOM/SVG, **but
 * NOT for the 2D Canvas**, which cannot interpret `var(--color-…)`. The Canvas consumer must
 * therefore inject a resolver returning a **real** color (e.g. read via `getComputedStyle`),
 * otherwise tokenized text/fills would be painted with an invalid color (hence invisible).
 */
export type ColorResolver = (value: string) => string;

/** True when the value is a ui-kit semantic token (otherwise: free color / transparent). */
export function isColorToken(value: string): boolean {
  return TOKEN_SET.has(value);
}

// Resolver active during a render (installed by `renderToCanvas`). Default = CSS variables.
let activeResolve: ColorResolver = resolveColor;
/** Drawable color through the active resolver. */
function paint(value: string): string {
  return activeResolve(value);
}

/** Semantic color of the selection indicator (ui-kit token, never hard-coded). */
export const SELECTION_COLOR: SemanticColorName = 'accent';

/**
 * Minimal subset of `CanvasRenderingContext2D` used by the renderer. Enables testing the
 * rendering without a real DOM (a double records the calls) and rendering server/worker side.
 */
export interface CanvasLike {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: readonly number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  // Drop shadow (optional: the test double may ignore them). Present on the real 2D context.
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

/** Canvas rendering options. */
export interface RenderOptions {
  /** When provided, clears this rectangle before drawing (frame). */
  readonly clear?: { width: number; height: number };
  /** World→screen transform (zoom/pan). Default: identity (1:1, origin at top-left). */
  readonly viewport?: Viewport;
  /** In-progress selection rectangle (**world** coordinates), drawn on top of the scene. */
  readonly marquee?: BoundingBox;
  /**
   * Ids of the elements **currently intersected by the marquee** (during the drag, before release):
   * drawn with a preview highlight to show what will be selected once the mouse is released.
   */
  readonly marqueeHighlightIds?: readonly string[];
  /** Alignment guide lines (snapping) to draw in **world** coordinates. */
  readonly guides?: { readonly x?: number; readonly y?: number };
  /** Id of the selected swimlane (highlight). */
  readonly selectedLaneId?: string;
  /** Id of the selected group (highlight). */
  readonly selectedGroupId?: string;
  /**
   * Token → drawable-color resolver. **Required for correct Canvas rendering** (the canvas does
   * not understand `var(--color-…)`). Default: `resolveColor` (CSS variables, for DOM/SVG).
   */
  readonly resolveColor?: ColorResolver;
  /**
   * Hides the selection frame and the handles (e.g. during in-place editing of an element, where a
   * DOM overlay covers the card → avoids the "double border" that looks like a shadow).
   */
  readonly suppressSelection?: boolean;
  /** Element to **skip drawing** (e.g. the one being edited: the DOM overlay represents it). */
  readonly hiddenElementId?: string;
  /**
   * Background dot grid (board style). `color` is resolved (token or literal); the grid
   * **follows pan/zoom** and hides itself when too dense. Requires `clear` (known screen size).
   */
  readonly dotGrid?: { readonly color: string; readonly spacing?: number };
  /**
   * **Remote** selections (collab): for each peer, the element ids they selected and their
   * `color` (token or literal). Drawn highlighted in the peer's color, under the local
   * selection, to see what others are manipulating.
   */
  readonly remoteSelections?: readonly {
    readonly ids: readonly string[];
    readonly color: string;
  }[];
}

/**
 * Draws a render model on a Canvas-like context, through the `viewport` (zoom/pan). Colors go
 * through `resolveColor` (ui-kit tokens). Draws a semantic selection frame around the selected
 * elements and, when provided, the marquee rectangle.
 *
 * `clear` operates in **screen** coordinates (before the transform); everything else is drawn in
 * **world** coordinates under the viewport transform. UI indicators (selection frame, marquee)
 * compensate for the zoom to keep a ~1px on-screen thickness.
 */
export function renderToCanvas(
  ctx: CanvasLike,
  model: RenderModel,
  options: RenderOptions = {},
): void {
  if (options.clear) {
    ctx.clearRect(0, 0, options.clear.width, options.clear.height);
  }
  const viewport = options.viewport ?? IDENTITY_VIEWPORT;
  activeResolve = options.resolveColor ?? resolveColor;

  try {
    // Dot grid (background), in screen space → follows pan/zoom, under everything else.
    if (options.dotGrid && options.clear) {
      drawDotGrid(ctx, options.clear.width, options.clear.height, viewport, options.dotGrid);
    }

    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);
    // Process board background: swimlanes (bands) then groups, under the elements.
    for (const lane of model.swimlanes)
      drawSwimlane(ctx, lane, viewport.zoom, lane.lane.id === options.selectedLaneId);
    for (const group of model.agentGroups)
      drawAgentGroup(ctx, group, viewport.zoom, group.group.id === options.selectedGroupId);

    for (const item of model.elements) {
      if (item.element.id === options.hiddenElementId) continue;
      drawItem(ctx, item);
    }
    // Remote selections (collab): per-peer colored highlight, under the local selection.
    if (options.remoteSelections?.length) {
      const boundsById = new Map(model.elements.map((it) => [it.element.id, it.bounds]));
      for (const sel of options.remoteSelections) {
        for (const id of sel.ids) {
          const bounds = boundsById.get(id);
          if (bounds) drawRemoteSelection(ctx, bounds, sel.color, viewport.zoom);
        }
      }
    }
    if (!options.suppressSelection) {
      const selected = model.elements.filter((item) => item.selected);
      for (const item of selected) {
        drawSelection(ctx, item, viewport.zoom);
      }
      // Transform handles: only on a **single** selection of a box-shaped element.
      if (selected.length === 1 && selected[0] && hasHandles(selected[0].element)) {
        drawHandles(ctx, selected[0], viewport.zoom);
      }
    }
    // Selection preview: highlight of the elements intersected by the marquee **before** release.
    if (options.marqueeHighlightIds?.length) {
      const boundsById = new Map(model.elements.map((it) => [it.element.id, it.bounds]));
      for (const id of options.marqueeHighlightIds) {
        const bounds = boundsById.get(id);
        if (bounds) drawMarqueeHighlight(ctx, bounds, viewport.zoom);
      }
    }
    if (options.guides) drawGuides(ctx, options.guides, viewport.zoom);
    if (options.marquee) drawMarquee(ctx, options.marquee, viewport.zoom);
  } finally {
    ctx.restore();
    activeResolve = resolveColor;
  }
}

/** Background dot grid (screen space), aligned with the world via pan/zoom. */
function drawDotGrid(
  ctx: CanvasLike,
  width: number,
  height: number,
  viewport: Viewport,
  opts: { readonly color: string; readonly spacing?: number },
): void {
  const spacing = (opts.spacing ?? 22) * viewport.zoom;
  if (spacing < 8) return; // too dense when zoomed out → hide
  const ox = ((viewport.x % spacing) + spacing) % spacing;
  const oy = ((viewport.y % spacing) + spacing) % spacing;
  const r = 1.6;
  ctx.save();
  ctx.fillStyle = paint(opts.color);
  ctx.beginPath();
  for (let x = ox; x <= width; x += spacing) {
    for (let y = oy; y <= height; y += spacing) {
      ctx.rect(x - r / 2, y - r / 2, r, r);
    }
  }
  ctx.fill();
  ctx.restore();
}

/** Per-element text format (#82) — subset read at render time. */
interface TextFormat {
  readonly textAlign?: 'left' | 'center' | 'right' | undefined;
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly strike?: boolean | undefined;
  readonly fontSize?: number | undefined;
}

/** Canvas `font` string from the format (base weight depends on the kind, e.g. 600 for a step). */
function fontFor(size: number, fmt: TextFormat, baseWeight = 400): string {
  const weight = fmt.bold ? 700 : baseWeight;
  return `${fmt.italic ? 'italic ' : ''}${weight} ${size}px sans-serif`;
}

/** Horizontal offset of a line of width `w` within `innerW`, according to the alignment. */
function alignOffset(align: 'left' | 'center' | 'right', w: number, innerW: number): number {
  if (align === 'center') return Math.max(0, (innerW - w) / 2);
  if (align === 'right') return Math.max(0, innerW - w);
  return 0;
}

/** Underline / strikethrough under a line (baseline `ty`), in the current text color `color`. */
function drawTextDecoration(
  ctx: CanvasLike,
  x: number,
  ty: number,
  w: number,
  size: number,
  fmt: TextFormat,
  color: string,
): void {
  if (!fmt.underline && !fmt.strike) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size / 14);
  if (fmt.underline) {
    const uy = ty + size * 0.14;
    ctx.beginPath();
    ctx.moveTo(x, uy);
    ctx.lineTo(x + w, uy);
    ctx.stroke();
  }
  if (fmt.strike) {
    const sy = ty - size * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, sy);
    ctx.lineTo(x + w, sy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Applies a soft **"card" drop shadow** around a filled path (sticky, filled shapes),
 * isolated inside `save/restore` so it does not bleed onto the outline/text or the next
 * elements. `fill` must (re)build the path then call `ctx.fill()`.
 */
function withCardShadow(ctx: CanvasLike, fill: () => void): void {
  ctx.save();
  // **Soft and diffuse** shadow: low opacity + large blur to detach the card without weighing it down.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;
  fill();
  ctx.restore();
}

/**
 * **Vertically centered multi-line** text label of a rectangle/ellipse shape, with per-element
 * format (#82: horizontal alignment + bold/italic/underline/strikethrough + size). No-op if empty.
 * Color = shape stroke (or `text` when the stroke is transparent). WYSIWYG with the in-place editor.
 */
function drawShapeLabel(
  ctx: CanvasLike,
  element: {
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string | undefined;
    stroke: string;
  } & TextFormat,
): void {
  const text = (element.text ?? '').trim();
  if (!text) return;
  const pad = 8;
  const innerW = Math.max(0, element.width - pad * 2);
  if (innerW < 4) return;
  const size = element.fontSize ?? 13;
  const align = element.textAlign ?? 'center';
  const color = paint(element.stroke === 'transparent' ? 'text' : element.stroke);
  ctx.fillStyle = color;
  ctx.font = fontFor(size, element);
  const lines = wrapText(ctx, text, innerW);
  const lineHeight = size * 1.25;
  const blockH = lines.length * lineHeight;
  let ty = element.y + Math.max(pad, (element.height - blockH) / 2) + size;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    const x = element.x + pad + alignOffset(align, w, innerW);
    ctx.fillText(line, x, ty);
    drawTextDecoration(ctx, x, ty, w, size, element, color);
    ty += lineHeight;
  }
}

/** Step tag (pill): `skill` (accent tint) or `deliverable` (success tint). */
type StepTag = { text: string; kind: 'skill' | 'deliverable' };
type LaidTag = StepTag & { w: number };

const TAG_H = 17; // pill height
const TAG_GAP = 4; // horizontal/vertical gap between pills
const TAG_PADX = 7; // inner horizontal padding
const TAG_FONT = '600 10px sans-serif';

/**
 * Lays out a step's tags as **rows of pills** fitting within `innerW` (automatic wrapping),
 * **capped at 2 rows**. Each label is truncated (ellipsis) when it alone overflows. The measuring
 * font (`TAG_FONT`) must be set by the caller.
 */
function layoutTags(ctx: CanvasLike, tags: readonly StepTag[], innerW: number): LaidTag[][] {
  if (tags.length === 0 || innerW < 24) return [];
  const rows: LaidTag[][] = [];
  let row: LaidTag[] = [];
  let rowW = 0;
  for (const t of tags) {
    const text = clampText(ctx, t.text, innerW - TAG_PADX * 2);
    const w = Math.min(innerW, ctx.measureText(text).width + TAG_PADX * 2);
    const projected = row.length === 0 ? w : rowW + TAG_GAP + w;
    if (row.length > 0 && projected > innerW) {
      rows.push(row);
      if (rows.length >= 2) return rows;
      row = [{ text, kind: t.kind, w }];
      rowW = w;
    } else {
      row.push({ text, kind: t.kind, w });
      rowW = projected;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Draws a row of pills, aligned (left/center/right) within `innerW`. */
function drawTagRow(
  ctx: CanvasLike,
  row: readonly LaidTag[],
  x0: number,
  top: number,
  innerW: number,
  align: 'left' | 'center' | 'right',
): void {
  const totalW = row.reduce((s, t) => s + t.w, 0) + TAG_GAP * (row.length - 1);
  let x = x0 + alignOffset(align, totalW, innerW);
  for (const t of row) {
    const bg = t.kind === 'skill' ? 'accent-subtle' : 'success-subtle';
    const fg = t.kind === 'skill' ? 'accent' : 'success';
    ctx.fillStyle = paint(bg);
    roundedRectPath(ctx, x, top, t.w, TAG_H, TAG_H / 2);
    ctx.fill();
    ctx.fillStyle = paint(fg);
    ctx.font = TAG_FONT;
    ctx.fillText(t.text, x + TAG_PADX, top + TAG_H - 5);
    x += t.w + TAG_GAP;
  }
}

function drawItem(ctx: CanvasLike, item: RenderItem): void {
  const { element } = item;
  ctx.save();
  ctx.globalAlpha = element.opacity;
  ctx.lineWidth = element.strokeWidth;
  ctx.strokeStyle = paint(element.stroke);
  ctx.fillStyle = paint(element.fill);
  // Stroke style: dashes (world scale, follows the zoom) or solid.
  ctx.setLineDash(element.strokeDash === 'dashed' ? [6, 4] : []);

  // Rotation around the center of the bounding box.
  const cx = item.bounds.x + item.bounds.width / 2;
  const cy = item.bounds.y + item.bounds.height / 2;
  if (element.angle !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(element.angle);
    ctx.translate(-cx, -cy);
  }

  switch (element.kind) {
    case 'rectangle': {
      // Filled shape → "card" drop shadow (detaches it without an outline), per-item opt-out.
      if (element.fill !== 'transparent') {
        const fill = (): void => {
          ctx.beginPath();
          ctx.rect(element.x, element.y, element.width, element.height);
          ctx.fill();
        };
        if (element.shadow !== false) withCardShadow(ctx, fill);
        else fill();
      }
      ctx.beginPath();
      ctx.rect(element.x, element.y, element.width, element.height);
      ctx.stroke(); // outline (visual no-op when `stroke` is transparent)
      drawShapeLabel(ctx, element);
      break;
    }
    case 'ellipse': {
      const ellipsePath = (): void => {
        ctx.beginPath();
        ctx.ellipse(
          element.x + element.width / 2,
          element.y + element.height / 2,
          element.width / 2,
          element.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      };
      if (element.fill !== 'transparent') {
        const fill = (): void => {
          ellipsePath();
          ctx.fill();
        };
        if (element.shadow !== false) withCardShadow(ctx, fill);
        else fill();
      }
      ellipsePath();
      ctx.stroke();
      drawShapeLabel(ctx, element);
      break;
    }
    case 'line':
    case 'arrow': {
      ctx.beginPath();
      const [first, ...rest] = element.points;
      if (first) {
        ctx.moveTo(element.x + first[0], element.y + first[1]);
        for (const [px, py] of rest) ctx.lineTo(element.x + px, element.y + py);
      }
      ctx.stroke();
      // Optional arrowheads at the ends (oriented along the last/first segment).
      const pts = element.points;
      const headSize = Math.max(9, element.strokeWidth * 4);
      const headColor = paint(element.stroke);
      if (pts.length >= 2) {
        if (element.endArrow) {
          const tip = pts[pts.length - 1]!;
          const from = pts[pts.length - 2]!;
          drawArrowhead(
            ctx,
            element.x + tip[0],
            element.y + tip[1],
            element.x + from[0],
            element.y + from[1],
            headSize,
            headColor,
          );
        }
        if (element.startArrow) {
          const tip = pts[0]!;
          const from = pts[1]!;
          drawArrowhead(
            ctx,
            element.x + tip[0],
            element.y + tip[1],
            element.x + from[0],
            element.y + from[1],
            headSize,
            headColor,
          );
        }
      }
      break;
    }
    case 'step': {
      // Process board card: background + **rounded-corner** frame, **centered multi-line** title,
      // optional description, then **tags** (skills/deliverables) and emotion.
      const fill = element.fill === 'transparent' ? 'surface' : element.fill;
      ctx.fillStyle = paint(fill);
      const drawCard = (): void => {
        roundedRectPath(ctx, element.x, element.y, element.width, element.height, STEP_RADIUS);
        ctx.fill();
      };
      // **Default** "card" drop shadow (absent = enabled; `false` disables it), isolated from the outline/text.
      if (element.shadow !== false) withCardShadow(ctx, drawCard);
      else drawCard();
      ctx.stroke();

      const pad = 10;
      const innerW = Math.max(0, element.width - pad * 2);
      const titleColor = paint(element.stroke === 'transparent' ? 'text' : element.stroke);
      const size = element.fontSize ?? 13;
      const align = element.textAlign ?? 'center';

      // Tags (skills then deliverables) at the bottom of the card — laid out as pills, wrapped if needed.
      const tags: StepTag[] = [
        ...element.skills.map((t) => ({ text: t, kind: 'skill' as const })),
        ...element.deliverables.map((t) => ({ text: t, kind: 'deliverable' as const })),
      ];
      ctx.font = TAG_FONT;
      const tagRows = layoutTags(ctx, tags, innerW);
      const tagsH = tagRows.length > 0 ? tagRows.length * (TAG_H + TAG_GAP) : 0;

      // Title (multi-line) — measured at weight 600 (`bold` pushes it to 700).
      const lineHeight = size * 1.25;
      ctx.font = fontFor(size, element, 600);
      const titleLines = wrapText(ctx, element.name || 'Étape', innerW);
      const titleH = titleLines.length * lineHeight;

      // Optional description (togglable): dimmed, smaller text, under the title.
      const descSize = Math.max(10, size - 2);
      const descLineH = descSize * 1.2;
      const descGap = 6;
      let descLines: string[] = [];
      if (element.showDescription === true && element.description.trim().length > 0) {
        ctx.font = fontFor(descSize, element);
        descLines = wrapText(ctx, element.description.trim(), innerW);
        // Clamp: do not encroach on the tags; keep what fits, with a trailing ellipsis.
        const avail = element.height - pad * 2 - tagsH - titleH - descGap;
        const maxLines = Math.max(0, Math.floor(avail / descLineH));
        if (descLines.length > maxLines) {
          descLines = descLines.slice(0, maxLines);
          const last = descLines[descLines.length - 1];
          if (last !== undefined) {
            descLines[descLines.length - 1] = clampText(ctx, `${last} …`, innerW);
          }
        }
      }
      const descH = descLines.length > 0 ? descLines.length * descLineH + descGap : 0;
      const blockH = titleH + descH;

      // Title+description block vertically centered in the space above the tags.
      const startTop = element.y + Math.max(pad, (element.height - tagsH - blockH) / 2);
      ctx.font = fontFor(size, element, 600);
      ctx.fillStyle = titleColor;
      let ty = startTop + size;
      for (const line of titleLines) {
        const w = ctx.measureText(line).width;
        const x = element.x + pad + alignOffset(align, w, innerW);
        ctx.fillText(line, x, ty);
        drawTextDecoration(ctx, x, ty, w, size, element, titleColor);
        ty += lineHeight;
      }
      if (descLines.length > 0) {
        ctx.font = fontFor(descSize, element);
        ctx.fillStyle = paint('muted');
        let dy = startTop + titleH + descGap + descSize;
        for (const line of descLines) {
          const w = ctx.measureText(line).width;
          const x = element.x + pad + alignOffset(align, w, innerW);
          ctx.fillText(line, x, dy);
          dy += descLineH;
        }
      }

      // Tags (pills) at the bottom of the card.
      if (tagRows.length > 0) {
        let tyTag = element.y + element.height - pad - tagsH + TAG_GAP;
        for (const row of tagRows) {
          drawTagRow(ctx, row, element.x + pad, tyTag, innerW, align);
          tyTag += TAG_H + TAG_GAP;
        }
      }
      if (element.emotion) {
        ctx.font = '14px sans-serif';
        const mark = element.emotion === 'happy' ? '😊' : element.emotion === 'sad' ? '😞' : '😐';
        ctx.fillText(mark, element.x + element.width - pad - 16, element.y + pad + 12);
      }
      // **Sub-process** indicator (bottom-right corner): the step opens a child whiteboard on double-click.
      if (element.subprocessRef) {
        ctx.font = '600 13px sans-serif';
        ctx.fillStyle = paint('accent');
        ctx.fillText('↗', element.x + element.width - pad - 8, element.y + element.height - pad);
      }
      break;
    }
    case 'text': {
      // Sticky note = text with a non-transparent `fill`: draw the background first, with a soft
      // **drop shadow** to detach it from the board (isolated in save/restore → does not bleed
      // onto the text or the next elements).
      const hasBackground = element.fill !== 'transparent';
      if (hasBackground) {
        ctx.fillStyle = paint(element.fill);
        const fill = (): void => {
          ctx.beginPath();
          ctx.rect(element.x, element.y, element.width, element.height);
          ctx.fill();
        };
        if (element.shadow !== false) withCardShadow(ctx, fill);
        else fill();
      }
      const size = element.fontSize;
      const align = element.textAlign ?? 'left';
      const color = paint(element.stroke);
      ctx.font = fontFor(size, element);
      ctx.fillStyle = color;
      const padding = hasBackground ? 6 : 0;
      const innerW = Math.max(0, element.width - padding * 2);
      // Multi-line: explicit line breaks are honored (no auto-wrap for free text).
      element.text.split('\n').forEach((line, i) => {
        const w = ctx.measureText(line).width;
        const x = element.x + padding + alignOffset(align, w, innerW);
        const ty = element.y + padding + (i + 1) * size;
        ctx.fillText(line, x, ty);
        drawTextDecoration(ctx, x, ty, w, size, element, color);
      });
      break;
    }
  }
  ctx.restore();
}

/** Splits an over-long word into chunks each fitting within `maxWidth` (character-by-character break). */
function breakWord(ctx: CanvasLike, word: string, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const ch of word) {
    if (current === '' || ctx.measureText(current + ch).width <= maxWidth) {
      current += ch;
    } else {
      chunks.push(current);
      current = ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Splits `text` into lines fitting within `maxWidth`: **word**-level wrapping, and
 * **character-by-character breaking** for a word wider than the box (it would overflow otherwise).
 * Assumes the `font` is already set on the context.
 */
function wrapText(ctx: CanvasLike, text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return text.split('\n');
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      // The word does not fit with the current line.
      if (current) {
        lines.push(current);
        current = '';
      }
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        // Single word too wide → break it; all chunks except the last are full lines.
        const chunks = breakWord(ctx, word, maxWidth);
        for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]!);
        current = chunks[chunks.length - 1] ?? '';
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/** Truncates `text` with an ellipsis to fit within `maxWidth` (single-line labels). */
function clampText(ctx: CanvasLike, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/**
 * Solid arrowhead at point `tip`, oriented from `from` → `tip`. `size` in **world** units
 * (follows the zoom like the rest of the path). Triangle filled with the stroke color.
 */
function drawArrowhead(
  ctx: CanvasLike,
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  size: number,
  color: string,
): void {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const a = 0.45; // half opening angle (~26°)
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const b1x = tipX - size * (ux * cos - uy * sin);
  const b1y = tipY - size * (ux * sin + uy * cos);
  const b2x = tipX - size * (ux * cos + uy * sin);
  const b2y = tipY - size * (-ux * sin + uy * cos);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(b1x, b1y);
  ctx.lineTo(b2x, b2y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Corner radius of a step card (world units). */
const STEP_RADIUS = 10;

/** Builds a **rounded-corner** rectangle path (DOM-free, via quadraticCurveTo). */
function roundedRectPath(
  ctx: CanvasLike,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSelection(ctx: CanvasLike, item: RenderItem, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = paint(SELECTION_COLOR);
  // Zoom-compensated thickness → ~1px on screen whatever the factor.
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.rect(item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height);
  ctx.stroke();
  ctx.restore();
}

/**
 * Highlight of an element selected by a **peer** (collab), in **their** color. Slight overhang +
 * thicker stroke to stand apart from the local selection (even when an element is selected both
 * by oneself and by a peer).
 */
function drawRemoteSelection(
  ctx: CanvasLike,
  bounds: BoundingBox,
  color: string,
  zoom: number,
): void {
  ctx.save();
  ctx.strokeStyle = paint(color);
  ctx.lineWidth = 1.5 / zoom;
  const pad = 3 / zoom;
  ctx.beginPath();
  ctx.rect(bounds.x - pad, bounds.y - pad, bounds.width + 2 * pad, bounds.height + 2 * pad);
  ctx.stroke();
  ctx.restore();
}

/**
 * Swimlane palette **taken from the extension** (`r,g,b`). The background is this color at very
 * low alpha, the separator at medium alpha, the header (dot + name) in full color — like the
 * reference editor. `neutral` is not in the palette: it falls back to the ui-kit tokens (theme).
 */
export const LANE_PALETTE: Record<string, string> = {
  blue: '79, 193, 255',
  green: '78, 201, 176',
  orange: '255, 183, 77',
  red: '255, 107, 107',
  purple: '187, 134, 252',
  yellow: '255, 235, 59',
};

/** Human-readable lane type label, displayed under the title. */
const LANE_TYPE_LABEL: Record<string, string> = {
  user: 'Utilisateur',
  system: 'Système',
  custom: 'Personnalisé',
};

function drawSwimlane(
  ctx: CanvasLike,
  item: RenderSwimlane,
  zoom: number,
  selected: boolean,
): void {
  const { lane, y, width } = item;
  const rgb = LANE_PALETTE[lane.color];
  // Effective colors: extension palette for named colors, ui-kit tokens for `neutral`.
  const fill = rgb
    ? `rgba(${rgb}, ${selected ? 0.18 : 0.1})`
    : `rgba(128, 128, 128, ${selected ? 0.14 : 0.07})`;
  const accent = rgb ? `rgb(${rgb})` : paint('muted');
  const border = rgb ? `rgba(${rgb}, 0.3)` : paint('border');

  ctx.save();
  // Tinted background (alpha embedded in the color).
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.rect(0, y, width, lane.height);
  ctx.fill();
  // Bottom separator (accent outline when selected).
  ctx.lineWidth = (selected ? 2 : 1) / zoom;
  ctx.strokeStyle = selected ? paint('accent') : border;
  ctx.beginPath();
  ctx.moveTo(0, y + lane.height);
  ctx.lineTo(width, y + lane.height);
  ctx.stroke();
  // Header: dot + name in the lane color (like the extension).
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.rect(8, y + 8, 10, 10);
  ctx.fill();
  ctx.font = '600 12px sans-serif';
  ctx.fillText(lane.name || 'Bande', 24, y + 16);
  // Lane type under the title (dimmed secondary label). For a **custom** type, show the free
  // label typed in when it exists, otherwise the generic word.
  const typeLabel =
    lane.laneType === 'custom' && lane.customType?.trim()
      ? lane.customType.trim()
      : (LANE_TYPE_LABEL[lane.laneType] ?? lane.laneType);
  ctx.font = '500 10px sans-serif';
  ctx.globalAlpha = 0.65;
  ctx.fillText(typeLabel, 24, y + 30);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawAgentGroup(
  ctx: CanvasLike,
  item: RenderAgentGroup,
  zoom: number,
  selected: boolean,
): void {
  const { group, bounds } = item;
  ctx.save();
  ctx.strokeStyle = paint('accent');
  ctx.lineWidth = (selected ? 2 : 1) / zoom;
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = paint('accent');
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.stroke();
  ctx.fillStyle = paint('accent');
  ctx.font = '600 11px sans-serif';
  ctx.fillText(group.name || 'Groupe', bounds.x + 6, bounds.y + 14);
  ctx.restore();
}

function drawHandles(ctx: CanvasLike, item: RenderItem, zoom: number): void {
  const size = HANDLE_SCREEN_SIZE / zoom;
  const handles = elementHandles(item.element, zoom);
  ctx.save();
  ctx.strokeStyle = paint(SELECTION_COLOR);
  ctx.fillStyle = paint('surface');
  ctx.lineWidth = 1 / zoom;

  // Stem connecting the top edge to the rotation handle.
  const top = handles.find((h) => h.kind === 'n');
  const rotate = handles.find((h) => h.kind === 'rotate');
  if (top && rotate) {
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rotate.x, rotate.y);
    ctx.stroke();
  }

  for (const handle of handles) {
    ctx.beginPath();
    if (handle.kind === 'rotate') {
      ctx.ellipse(handle.x, handle.y, size / 2, size / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(handle.x - size / 2, handle.y - size / 2, size, size);
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawGuides(
  ctx: CanvasLike,
  guides: { readonly x?: number; readonly y?: number },
  zoom: number,
): void {
  // Full-crossing lines (the extent is intentionally large: the canvas clips).
  const EXTENT = 100_000;
  ctx.save();
  ctx.strokeStyle = paint(SELECTION_COLOR);
  ctx.lineWidth = 1 / zoom;
  if (guides.x !== undefined) {
    ctx.beginPath();
    ctx.moveTo(guides.x, -EXTENT);
    ctx.lineTo(guides.x, EXTENT);
    ctx.stroke();
  }
  if (guides.y !== undefined) {
    ctx.beginPath();
    ctx.moveTo(-EXTENT, guides.y);
    ctx.lineTo(EXTENT, guides.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * **Preview** highlight of an element intersected by the in-progress marquee (before release):
 * light veil + outline in the selection color, with a small overhang to clearly signal "this will be picked".
 */
function drawMarqueeHighlight(ctx: CanvasLike, bounds: BoundingBox, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = paint(SELECTION_COLOR);
  ctx.fillStyle = paint(SELECTION_COLOR);
  ctx.lineWidth = 1.5 / zoom;
  const pad = 2 / zoom;
  const x = bounds.x - pad;
  const y = bounds.y - pad;
  const w = bounds.width + 2 * pad;
  const h = bounds.height + 2 * pad;
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
  ctx.restore();
}

function drawMarquee(ctx: CanvasLike, box: BoundingBox, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = paint(SELECTION_COLOR);
  ctx.fillStyle = paint(SELECTION_COLOR);
  ctx.lineWidth = 1 / zoom;
  // Translucent veil to materialize the area, sharp outline on top.
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.stroke();
  ctx.restore();
}
