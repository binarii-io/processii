/**
 * **Tool registry** exposed to the Mistral model. Each tool gathers, in a single source of truth:
 * - a **zod schema** (runtime validation of the arguments coming from the model);
 * - its conversion to **JSON Schema** (`z.toJSONSchema`) for the `function.parameters` field sent
 *   to the API (the `enum`s are included → the model does not invent values);
 * - a **handler** mutating the board through the **engine's public API** (never the DOM).
 *
 * Ids are **generated here** (`ToolContext.genId`) because `engine.addElement`/`connect` do not
 * auto-generate them, then **returned to the model** so it can connect/edit afterwards.
 *
 * See `README.md` (§ AI assistant — tool list) and the `whiteboard-shared-ui` skill (engine API).
 */
import { z } from 'zod';
import {
  STEP_EMOTIONS,
  SWIMLANE_COLORS,
  type ElementPatch,
  type WhiteboardElement,
  type WhiteboardEngine,
} from '@binarii/processii';
import { summarizeBoard } from './board-summary.js';

/** Tool execution context: the target engine + an id generator (injectable for the tests). */
export interface ToolContext {
  readonly engine: WhiteboardEngine;
  readonly genId: () => string;
}

/** Tool result (JSON-serializable) returned to the model. `message` feeds the UI trace. */
export type ToolResult = Record<string, unknown> & { readonly message?: string };

/** Ready-to-use tool (schema erased: internal validation before `run`). */
export interface ToolDef {
  readonly name: string;
  readonly description: string;
  /** Potentially destructive action → confirmation possible (see the agent loop). */
  readonly destructive: boolean;
  /** JSON Schema of the parameters (the API's `function.parameters` field). */
  readonly parameters: Record<string, unknown>;
  /** Validates `rawArgs` (object already parsed from the JSON string) then executes. Throws on invalid argument. */
  run(ctx: ToolContext, rawArgs: unknown): ToolResult;
}

/** Typed factory: keeps strong per-tool typing, erases to `ToolDef` for the registry. */
function defineTool<A>(def: {
  name: string;
  description: string;
  destructive?: boolean;
  schema: z.ZodType<A>;
  run(ctx: ToolContext, args: A): ToolResult;
}): ToolDef {
  return {
    name: def.name,
    description: def.description,
    destructive: def.destructive ?? false,
    parameters: z.toJSONSchema(def.schema) as Record<string, unknown>,
    run(ctx, rawArgs) {
      const parsed = def.schema.parse(rawArgs); // ZodError when invalid → caught by the dispatcher
      return def.run(ctx, parsed);
    },
  };
}

// — Default dimensions (aligned with the package toolbar) —
const STEP_W = 200;
const STEP_H = 120;
// Minimum vertical margin between a card and its lane edges (centering + height auto-fit).
const LANE_MARGIN = 12;
// Flow start: room is left for the **lane label** on the left (otherwise the first step's title
// is hidden). Horizontal spacing between successive steps.
const LANE_START_X = 240;
const STEP_GAP = 64;
const SHAPE_DIMS = {
  rectangle: { width: 120, height: 80 },
  ellipse: { width: 100, height: 100 },
  text: { width: 160, height: 32 },
} as const;

type StepElement = Extract<WhiteboardElement, { kind: 'step' }>;
const isStep = (e: WhiteboardElement): e is StepElement => e.kind === 'step';

type ConnectorElement = Extract<WhiteboardElement, { kind: 'arrow' | 'line' }>;
const isConnector = (e: WhiteboardElement): e is ConnectorElement =>
  e.kind === 'arrow' || e.kind === 'line';

/** Next x of the **global** flow (left→right chronology, never reset per lane). */
function nextFlowX(engine: WhiteboardEngine): number {
  const steps = engine.listElements().filter(isStep);
  if (steps.length === 0) return LANE_START_X;
  return steps.reduce((m, s) => Math.max(m, s.x + s.width), 0) + STEP_GAP;
}

/**
 * Steps belonging to `clusterId`: those **assigned** (`swimlaneId`) to one of its lanes — even if
 * placed beyond the current width, which is exactly when we must widen — plus unassigned steps whose
 * center geometrically falls in one of its lanes. A step assigned to another cluster's lane is out.
 */
function stepsInCluster(engine: WhiteboardEngine, clusterId: string): StepElement[] {
  const laneIds = new Set(
    engine
      .listSwimlanes()
      .filter((l) => l.clusterId === clusterId)
      .map((l) => l.id),
  );
  if (laneIds.size === 0) return [];
  return engine
    .listElements()
    .filter(isStep)
    .filter((s) => {
      if (s.swimlaneId) return laneIds.has(s.swimlaneId); // explicit assignment is authoritative
      const owner = engine.laneAtPoint({ x: s.x + s.width / 2, y: s.y + s.height / 2 });
      return owner !== undefined && laneIds.has(owner);
    });
}

/** Next x of the flow **within a cluster**, measured from the cluster's own left edge. */
function clusterFlowX(engine: WhiteboardEngine, clusterId: string, clusterLeft: number): number {
  const steps = stepsInCluster(engine, clusterId);
  if (steps.length === 0) return clusterLeft + LANE_START_X;
  return steps.reduce((m, s) => Math.max(m, s.x + s.width), 0) + STEP_GAP;
}

/** Places a new step: x = flow **within the lane's cluster**, y = centered in the lane's band. */
function nextStepPosition(engine: WhiteboardEngine, swimlaneId?: string): { x: number; y: number } {
  if (swimlaneId) {
    const band = engine.laneBand(swimlaneId);
    const clusterId = engine.listSwimlanes().find((l) => l.id === swimlaneId)?.clusterId;
    if (band && clusterId !== undefined) {
      return {
        x: clusterFlowX(engine, clusterId, band.x),
        y: band.y + Math.max(LANE_MARGIN, (band.height - STEP_H) / 2),
      };
    }
  }
  // No lane: global flow, aligned to the rightmost step (or a default y).
  const x = nextFlowX(engine);
  const steps = engine.listElements().filter(isStep);
  const rightmost = steps.length
    ? steps.reduce((r, s) => (s.x + s.width > r.x + r.width ? s : r), steps[0]!)
    : null;
  return { x, y: rightmost ? rightmost.y : 80 };
}

/** Widens **each cluster** to contain the steps in its lanes (otherwise they overflow to the right). */
function ensureLanesWidth(engine: WhiteboardEngine): void {
  for (const cluster of engine.listSwimlaneClusters()) {
    const steps = stepsInCluster(engine, cluster.id);
    if (steps.length === 0) continue;
    const rightEdge = steps.reduce((m, s) => Math.max(m, s.x + s.width), 0);
    const needed = rightEdge - cluster.x + 120;
    // Write the per-cluster width override (the source geometry/UI actually read), not the meta.
    if (cluster.width < needed) engine.updateSwimlaneCluster(cluster.id, { width: needed });
  }
}

/** Readable label of an element for the trace (step name, shape text, or id). */
function labelOf(engine: WhiteboardEngine, id: string): string {
  const el = engine.board.getElement(id);
  if (!el) return id;
  if (el.kind === 'step') return el.name || id;
  if ('text' in el && typeof el.text === 'string' && el.text.length > 0) return el.text;
  return id;
}

/** Resolves a lane reference **by id OR by name** (case-insensitive) to its actual id. */
function resolveLaneId(engine: WhiteboardEngine, ref: string): string | undefined {
  const lanes = engine.listSwimlanes();
  if (lanes.some((l) => l.id === ref)) return ref;
  const r = ref.trim().toLowerCase();
  return lanes.find((l) => l.name.trim().toLowerCase() === r)?.id;
}

/**
 * Resolves a **group (cluster)** reference: the id/name of ANY lane in it (a cluster's identity is
 * lane membership) OR a raw cluster id. Returns the cluster id.
 */
function resolveClusterId(engine: WhiteboardEngine, ref: string): string | undefined {
  const laneId = resolveLaneId(engine, ref);
  if (laneId) return engine.listSwimlanes().find((l) => l.id === laneId)?.clusterId;
  return engine.listSwimlaneClusters().some((c) => c.id === ref) ? ref : undefined;
}

/** Claims a new element's id: the one **provided by the model** (stable slug) otherwise generated.
 *  Throws when the provided id is already taken (the caller will reuse it to reference → collision = bug). */
function claimElementId(ctx: ToolContext, provided?: string): string {
  const id = provided?.trim();
  if (!id) return ctx.genId();
  if (ctx.engine.board.getElement(id)) throw new Error(`Id déjà utilisé : ${id}.`);
  return id;
}

/** Like `claimElementId` but **without throwing** on collision: falls back to a generated id (for
 *  elements whose id is not re-referenced afterwards, e.g. the steps of an auto-linked addHandoff). */
function claimOrGenId(ctx: ToolContext, provided?: string): string {
  const id = provided?.trim();
  return id && !ctx.engine.board.getElement(id) ? id : ctx.genId();
}

// Editable emotion: the real values + `'none'` to **remove** the badge (clear → `null` patch).
// `'none'` is exposed to the model in the JSON Schema so it knows how to clear an emotion.
const EMOTIONS_WITH_CLEAR = [...STEP_EMOTIONS, 'none'] as const;
const emotionUpdate = z.enum(EMOTIONS_WITH_CLEAR);
const colorEnum = z.enum(SWIMLANE_COLORS);
const laneTypeEnum = z.enum(['user', 'system', 'custom']);

const colorStr = z.string().min(1);

// Numbers aligned with the engine schema (`.finite()`): a non-finite number becomes a CLEAR
// invalid argument on the zod side, instead of an opaque "Élément de whiteboard invalide" at merge time.
const finiteNum = z.number().finite();
const positiveNum = z.number().finite().positive();

// — **Text formatting** fields (shared step / shape) —
const textFormatShape = {
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontSize: positiveNum.optional().describe('Taille de police (px)'),
  textAlign: z
    .enum(['left', 'center', 'right'])
    .optional()
    .describe('Alignement (left|center|right)'),
} as const;

// — **Appearance** fields (colors / outline / shadow / opacity) —
const appearanceShape = {
  fill: colorStr
    .optional()
    .describe(
      'Fond — token ui-kit (surface, accent, muted, transparent…) ou couleur CSS (#ef4444, red)',
    ),
  stroke: colorStr.optional().describe('Contour — token ui-kit ou couleur CSS'),
  strokeWidth: positiveNum.optional(),
  opacity: z.number().min(0).max(1).optional(),
  shadow: z.boolean().optional().describe('Ombre portée'),
} as const;

// — **Geometry** fields (move / resize) —
const geometryShape = {
  x: finiteNum.optional(),
  y: finiteNum.optional(),
  width: positiveNum.optional(),
  height: positiveNum.optional(),
} as const;

/** Args containing the formatting / appearance / geometry fields (common subset).
 *  Explicit `| undefined` to accept the zod-inferred type under `exactOptionalPropertyTypes`. */
interface StyleArgs {
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  underline?: boolean | undefined;
  strike?: boolean | undefined;
  fontSize?: number | undefined;
  textAlign?: 'left' | 'center' | 'right' | undefined;
  fill?: string | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  opacity?: number | undefined;
  shadow?: boolean | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/** Builds an engine patch from only the provided style/geometry fields. */
function stylePatch(a: StyleArgs): ElementPatch {
  return {
    ...(a.bold !== undefined ? { bold: a.bold } : {}),
    ...(a.italic !== undefined ? { italic: a.italic } : {}),
    ...(a.underline !== undefined ? { underline: a.underline } : {}),
    ...(a.strike !== undefined ? { strike: a.strike } : {}),
    ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
    ...(a.textAlign !== undefined ? { textAlign: a.textAlign } : {}),
    ...(a.fill !== undefined ? { fill: a.fill } : {}),
    ...(a.stroke !== undefined ? { stroke: a.stroke } : {}),
    ...(a.strokeWidth !== undefined ? { strokeWidth: a.strokeWidth } : {}),
    ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
    ...(a.shadow !== undefined ? { shadow: a.shadow } : {}),
    ...(a.x !== undefined ? { x: a.x } : {}),
    ...(a.y !== undefined ? { y: a.y } : {}),
    ...(a.width !== undefined ? { width: a.width } : {}),
    ...(a.height !== undefined ? { height: a.height } : {}),
  };
}

/** True when the patch changes the geometry → re-route the bound connectors. */
function geomChanged(a: StyleArgs): boolean {
  return a.x !== undefined || a.y !== undefined || a.width !== undefined || a.height !== undefined;
}

// ————————————————————————————————————————————————————————————————————————————
// Steps
// ————————————————————————————————————————————————————————————————————————————

const addStep = defineTool({
  name: 'addStep',
  description:
    'Ajoute une étape (carte de processus). **Choisis toi-même un `id` court et stable** (slug, ex. ' +
    '"signer-contrat") que tu RÉUTILISERAS pour connecter/éditer. Positionnement auto sauf si x/y ' +
    'fournis. `swimlaneId` accepte l’id OU le nom de la bande.',
  schema: z.object({
    id: z.string().optional().describe('Id stable choisi par toi (slug), réutilisable ensuite'),
    name: z.string().min(1).describe("Titre de l'étape"),
    description: z
      .string()
      .optional()
      .describe('Corps de texte affiché SOUS le titre de la carte (≠ name)'),
    skills: z.array(z.string()).optional().describe('Compétences (pills)'),
    deliverables: z.array(z.string()).optional().describe('Livrables (pills)'),
    swimlaneId: z.string().optional().describe('Bande de rattachement (id OU nom)'),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  run(ctx, a) {
    let laneId: string | undefined;
    if (a.swimlaneId) {
      laneId = resolveLaneId(ctx.engine, a.swimlaneId);
      if (!laneId) throw new Error(`Aucune bande « ${a.swimlaneId} ».`);
    }
    const id = claimElementId(ctx, a.id);
    const pos =
      a.x !== undefined && a.y !== undefined
        ? { x: a.x, y: a.y }
        : nextStepPosition(ctx.engine, laneId);
    const hasDesc = a.description !== undefined && a.description.trim().length > 0;
    ctx.engine.addElement(
      {
        kind: 'step',
        id,
        x: pos.x,
        y: pos.y,
        width: STEP_W,
        height: STEP_H,
        name: a.name,
        textAlign: 'left', // process convention: step text always left-aligned
        // Non-empty description → set it AND show it (otherwise neither stored nor shown).
        ...(hasDesc ? { description: a.description, showDescription: true } : {}),
        ...(a.skills ? { skills: a.skills } : {}),
        ...(a.deliverables ? { deliverables: a.deliverables } : {}),
        ...(laneId ? { swimlaneId: laneId } : {}),
      },
      { select: false },
    );
    ensureLanesWidth(ctx.engine);
    return {
      id,
      descriptionSet: hasDesc,
      message: `✅ Étape « ${a.name} » ajoutée${hasDesc ? ' (avec description)' : ''}.`,
    };
  },
});

const updateStep = defineTool({
  name: 'updateStep',
  description:
    'Modifie une étape (par id). Seuls les champs fournis changent. Couvre le contenu (name, ' +
    "description, showDescription, skills, deliverables, swimlaneId), l'émotion (emotion='none' pour " +
    'la retirer), la mise en forme (bold/italic/underline/strike/fontSize/textAlign), l’apparence ' +
    '(fill/stroke/strokeWidth/opacity/shadow) et la géométrie (x/y/width/height pour déplacer/redimensionner).',
  schema: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z
      .string()
      .optional()
      .describe('Corps de texte affiché SOUS le titre de la carte (≠ name). Vide = inchangé.'),
    showDescription: z.boolean().optional().describe('Afficher la description sur la carte'),
    skills: z.array(z.string()).optional(),
    deliverables: z.array(z.string()).optional(),
    emotion: emotionUpdate.optional().describe("Émotion, ou 'none' pour la retirer"),
    swimlaneId: z.string().optional(),
    ...textFormatShape,
    ...appearanceShape,
    ...geometryShape,
  }),
  run(ctx, a) {
    const el = ctx.engine.board.getElement(a.id);
    if (!el || el.kind !== 'step') throw new Error(`Aucune étape avec l'id ${a.id}.`);
    let laneId: string | undefined;
    if (a.swimlaneId !== undefined) {
      laneId = resolveLaneId(ctx.engine, a.swimlaneId);
      if (!laneId) throw new Error(`Aucune bande « ${a.swimlaneId} ».`);
    }
    // **Non-empty** description only: an empty string is a NO-OP (never overwrites an existing
    // description — e.g. re-call on the 2nd auto-continuation turn). Also enables the display.
    const desc = a.description?.trim() ? a.description : undefined;
    const patch: ElementPatch = {
      ...(a.name !== undefined ? { name: a.name } : {}),
      ...(desc !== undefined ? { description: desc } : {}),
      ...(a.showDescription !== undefined
        ? { showDescription: a.showDescription }
        : desc !== undefined
          ? { showDescription: true }
          : {}),
      ...(a.skills !== undefined ? { skills: a.skills } : {}),
      ...(a.deliverables !== undefined ? { deliverables: a.deliverables } : {}),
      // 'none' → clears the emotion (`null` patch), otherwise applied.
      ...(a.emotion !== undefined ? { emotion: a.emotion === 'none' ? null : a.emotion } : {}),
      ...(laneId !== undefined ? { swimlaneId: laneId } : {}),
      ...stylePatch(a),
    };
    // Attaching to a swimlane = also **repositioning** the step inside the lane (otherwise
    // `swimlaneId` is set but the step does not move → it visually stays in another lane). It is
    // vertically centered in the lane; an explicitly provided `y` wins.
    let movedToLane = false;
    if (laneId !== undefined && a.y === undefined) {
      const lane = ctx.engine.listSwimlanes().find((l) => l.id === laneId);
      if (lane) {
        patch.y = ctx.engine.laneTop(laneId) + Math.max(12, (lane.height - el.height) / 2);
        movedToLane = true;
      }
    }
    if (!ctx.engine.updateElement(a.id, patch)) throw new Error('Mise à jour impossible.');
    if (geomChanged(a) || movedToLane) {
      ctx.engine.refreshConnectors();
      ensureLanesWidth(ctx.engine);
    }
    return {
      ok: true,
      descriptionSet: desc !== undefined,
      message: `✏️ Étape « ${a.name ?? el.name} » mise à jour${desc !== undefined ? ' (description ajoutée)' : ''}.`,
    };
  },
});

const moveStepToLane = defineTool({
  name: 'moveStepToLane',
  description:
    'PLACE RÉELLEMENT une étape DANS une bande : pose son `swimlaneId` ET **repositionne la carte** pour ' +
    'qu’elle tombe géométriquement dans la bande (centre la verticale, garde la carte dans la largeur). ' +
    'Si la carte est plus HAUTE que la bande, **agrandit la bande** pour qu’elle tienne. **Préfère cet ' +
    'outil à updateStep(swimlaneId)** pour « ranger / déplacer une étape dans une bande » : poser ' +
    '`swimlaneId` seul ne déplace pas la carte si elle est ailleurs. Bande par id OU nom. Retourne la ' +
    'géométrie finale.',
  schema: z.object({
    stepId: z.string().min(1),
    laneId: z.string().min(1).describe('Bande cible (id OU nom)'),
    x: finiteNum
      .optional()
      .describe(
        'Position x (chronologie gauche→droite) ; sinon conserve la x actuelle de la carte',
      ),
  }),
  run(ctx, a) {
    const el = ctx.engine.board.getElement(a.stepId);
    if (!el || el.kind !== 'step') throw new Error(`Aucune étape avec l'id ${a.stepId}.`);
    const laneId = resolveLaneId(ctx.engine, a.laneId);
    if (!laneId) throw new Error(`Aucune bande « ${a.laneId} ».`);
    // 1) Auto-fit: the lane must be able to contain the card, otherwise it visually overflows
    //    (and `swimlaneId` would lie). Grown as needed, then the cards of the lanes below are
    //    recentered (they just shifted down).
    const lane = laneById(ctx.engine, laneId)!;
    const neededHeight = el.height + 2 * LANE_MARGIN;
    let grewLane = false;
    if (lane.height < neededHeight) {
      ctx.engine.updateSwimlane(laneId, { height: neededHeight });
      grewLane = true;
      recenterAssignedSteps(ctx.engine);
    }
    // 2) Place the card: centered in the lane (height possibly updated), x kept/forced but never
    //    left of the lane's **cluster** edge (a cluster may sit at x ≠ 0).
    const y = laneCenterY(ctx.engine, laneId, el.height);
    const leftFloor = ctx.engine.laneBand(laneId)?.x ?? 0;
    const x = Math.max(leftFloor, a.x !== undefined ? a.x : el.x);
    if (!ctx.engine.updateElement(a.stepId, { swimlaneId: laneId, x, y }))
      throw new Error('Déplacement impossible.');
    // 3) The shared width must contain the card (otherwise it sticks out right, outside the visible lane).
    ensureLanesWidth(ctx.engine);
    ctx.engine.refreshConnectors();
    const out = ctx.engine.board.getElement(a.stepId)!;
    return {
      ok: true,
      laneId,
      grewLane,
      x: out.x,
      y: out.y,
      width: out.width,
      height: out.height,
      message: `📥 « ${el.name || a.stepId} » placée dans la bande${grewLane ? ' (bande agrandie pour la contenir)' : ''}.`,
    };
  },
});

const deleteElement = defineTool({
  name: 'deleteElement',
  description:
    "Supprime n'importe quel élément (étape, forme libre ou lien) par id, ainsi que les liens qui y " +
    'sont rattachés.',
  destructive: true,
  schema: z.object({ id: z.string().min(1) }),
  run(ctx, a) {
    const el = ctx.engine.board.getElement(a.id);
    if (!el) throw new Error(`Aucun élément avec l'id ${a.id}.`);
    const label = labelOf(ctx.engine, a.id);
    // Purges the orphan connectors (removeElement does not do it).
    const orphans = ctx.engine
      .listElements()
      .filter(
        (e) => (e.kind === 'arrow' || e.kind === 'line') && (e.start === a.id || e.end === a.id),
      );
    for (const o of orphans) ctx.engine.removeElement(o.id);
    ctx.engine.removeElement(a.id);
    ctx.engine.refreshConnectors();
    return {
      ok: true,
      removedConnectors: orphans.length,
      message: `🗑️ « ${label} » supprimé${orphans.length ? ` (+${orphans.length} lien(s))` : ''}.`,
    };
  },
});

// ————————————————————————————————————————————————————————————————————————————
// Connectors
// ————————————————————————————————————————————————————————————————————————————

const connectSteps = defineTool({
  name: 'connectSteps',
  description:
    "Relie deux éléments (du premier vers le second). Retourne l'id du lien. **Pour un passage entre " +
    'deux acteurs (bandes différentes), préfère `addHandoff`** (envoi+réception alignés) ; n’utilise un ' +
    'lien direct inter-bandes que si l’utilisateur le demande explicitement. Flèche à l’arrivée par ' +
    'défaut ; endArrow=false pour un trait simple, startArrow=true pour bidirectionnel.',
  schema: z.object({
    id: z.string().optional().describe('Id stable du lien (slug, sinon auto)'),
    fromId: z.string().min(1).describe('Id de l’élément source (celui que tu lui as donné)'),
    toId: z.string().min(1).describe('Id de l’élément cible'),
    endArrow: z.boolean().optional().describe('Flèche à l’arrivée (défaut: true)'),
    startArrow: z.boolean().optional().describe('Flèche au départ (défaut: false)'),
  }),
  run(ctx, a) {
    if (!ctx.engine.board.getElement(a.fromId))
      throw new Error(`Aucun élément source ${a.fromId}.`);
    if (!ctx.engine.board.getElement(a.toId)) throw new Error(`Aucun élément cible ${a.toId}.`);
    if (a.fromId === a.toId) throw new Error('Source et cible identiques.');
    const id = claimElementId(ctx, a.id);
    const arrow = ctx.engine.connect(id, a.fromId, a.toId, {
      endArrow: a.endArrow ?? true,
      ...(a.startArrow !== undefined ? { startArrow: a.startArrow } : {}),
    });
    if (!arrow) throw new Error('Connexion impossible.');
    return {
      id,
      message: `🔗 ${labelOf(ctx.engine, a.fromId)} → ${labelOf(ctx.engine, a.toId)}`,
    };
  },
});

const connectFlow = defineTool({
  name: 'connectFlow',
  description:
    'Relie une **séquence** d’étapes dans l’ordre fourni (ids[0]→ids[1]→ids[2]…), en un seul appel. ' +
    'À utiliser pour connecter d’un coup toutes les étapes successives d’une bande (séquence d’un ' +
    'acteur). Ignore les liens déjà existants (pas de doublon).',
  schema: z.object({
    ids: z
      .array(z.string().min(1))
      .min(2)
      .describe('Ids des étapes dans l’ordre chronologique (au moins 2)'),
    endArrow: z.boolean().optional().describe('Flèche à l’arrivée (défaut: true)'),
  }),
  run(ctx, a) {
    let created = 0;
    const failures: string[] = [];
    for (let i = 0; i < a.ids.length - 1; i += 1) {
      const from = a.ids[i]!;
      const to = a.ids[i + 1]!;
      if (from === to) continue;
      if (!ctx.engine.board.getElement(from) || !ctx.engine.board.getElement(to)) {
        failures.push(`${from}→${to}`);
        continue;
      }
      const dup = ctx.engine
        .listElements()
        .some((e) => (e.kind === 'arrow' || e.kind === 'line') && e.start === from && e.end === to);
      if (dup) continue;
      if (ctx.engine.connect(ctx.genId(), from, to, { endArrow: a.endArrow ?? true })) created += 1;
      else failures.push(`${from}→${to}`);
    }
    return {
      created,
      failures,
      message: `🔗 Séquence : ${created} lien(s) créé(s)${failures.length ? ` — ${failures.length} échec(s)` : ''}.`,
    };
  },
});

const tidyFlow = defineTool({
  name: 'tidyFlow',
  description:
    'FINALISE le flux (déterministe) : pour CHAQUE bande, connecte gauche→droite les étapes successives ' +
    'qui ne le sont pas encore, et corrige le sens des liens intra-bande inversés. Ne touche pas aux ' +
    'transmissions verticales (handoffs). À appeler **à la fin** de la modélisation.',
  schema: z.object({}),
  run(ctx) {
    let created = 0;
    let fixed = 0;
    const connectorsOf = (): ConnectorElement[] => ctx.engine.listElements().filter(isConnector);
    for (const lane of ctx.engine.listSwimlanes()) {
      const steps = ctx.engine
        .listElements()
        .filter(isStep)
        .filter((s) => s.swimlaneId === lane.id)
        .sort((p, q) => p.x - q.x);
      for (let i = 0; i < steps.length - 1; i += 1) {
        const a = steps[i]!; // a.x <= b.x → a is the chronological upstream
        const b = steps[i + 1]!;
        const links = connectorsOf();
        const forward = links.find((e) => e.start === a.id && e.end === b.id);
        if (forward) continue;
        const reversed = links.find((e) => e.start === b.id && e.end === a.id);
        if (reversed) ctx.engine.removeElement(reversed.id);
        const ok = ctx.engine.connect(ctx.genId(), a.id, b.id, { endArrow: true });
        if (ok) {
          if (reversed) fixed += 1;
          else created += 1;
        }
      }
    }
    ctx.engine.refreshConnectors();
    return {
      created,
      fixed,
      message: `🧹 Flux finalisé : ${created} lien(s) ajouté(s), ${fixed} sens corrigé(s).`,
    };
  },
});

const tidyLayout = defineTool({
  name: 'tidyLayout',
  description:
    'RANGE la **mise en page** (déterministe, pendant géométrique de `tidyFlow`) : pour CHAQUE bande, ' +
    'agrandit sa hauteur si une carte n’y tient pas, recentre verticalement toutes les étapes dans leur ' +
    'bande, et étend la largeur partagée pour contenir toutes les cartes. À appeler quand des cartes ' +
    'débordent / sont hors de leur bande, ou après de gros déplacements. Ne crée/supprime aucun lien ' +
    '(pour les liens, vois `tidyFlow`). N’aplatit pas les bandes déjà plus grandes (jamais de rétrécissement).',
  schema: z.object({}),
  run(ctx) {
    let grownLanes = 0;
    for (const lane of ctx.engine.listSwimlanes()) {
      const tallest = ctx.engine
        .listElements()
        .filter(isStep)
        .filter((s) => s.swimlaneId === lane.id)
        .reduce((m, s) => Math.max(m, s.height), 0);
      const neededHeight = (tallest || STEP_H) + 2 * LANE_MARGIN;
      // Grow only (never shrink): a manually enlarged lane stays respected.
      if (lane.height < neededHeight) {
        ctx.engine.updateSwimlane(lane.id, { height: neededHeight });
        grownLanes += 1;
      }
    }
    const recentered = recenterAssignedSteps(ctx.engine);
    ensureLanesWidth(ctx.engine);
    ctx.engine.refreshConnectors();
    return {
      grownLanes,
      recentered,
      message: `🧹 Mise en page rangée : ${grownLanes} bande(s) agrandie(s), ${recentered} étape(s) recentrée(s).`,
    };
  },
});

const disconnectSteps = defineTool({
  name: 'disconnectSteps',
  description: 'Supprime un lien existant (par son id de connecteur).',
  schema: z.object({ connectorId: z.string().min(1) }),
  run(ctx, a) {
    const el = ctx.engine.board.getElement(a.connectorId);
    if (!el || (el.kind !== 'arrow' && el.kind !== 'line')) {
      throw new Error(`Aucun lien avec l'id ${a.connectorId}.`);
    }
    ctx.engine.removeElement(a.connectorId);
    return { ok: true, message: '🔗 Lien supprimé.' };
  },
});

/** Lane (swimlane) by id, or `undefined`. */
function laneById(engine: WhiteboardEngine, laneId: string) {
  return engine.listSwimlanes().find((l) => l.id === laneId);
}

/** Centered y of a step inside a given lane. */
function laneCenterY(engine: WhiteboardEngine, laneId: string, stepHeight: number): number {
  const lane = laneById(engine, laneId);
  const top = engine.laneTop(laneId);
  return top + Math.max(LANE_MARGIN, ((lane?.height ?? 160) - stepHeight) / 2);
}

/**
 * Vertically recenters **all attached steps** inside their lane. Call after any **lane height**
 * change: growing a lane shifts the lanes below, which off-centers their cards (the `swimlaneId`
 * stays right but not the position). Touches neither `x` nor the lane-less steps. Returns the
 * number of steps actually moved.
 */
function recenterAssignedSteps(engine: WhiteboardEngine): number {
  let moved = 0;
  for (const s of engine.listElements().filter(isStep)) {
    if (!s.swimlaneId || !laneById(engine, s.swimlaneId)) continue;
    const y = laneCenterY(engine, s.swimlaneId, s.height);
    if (s.y !== y) {
      engine.updateElement(s.id, { y });
      moved += 1;
    }
  }
  return moved;
}

const addHandoff = defineTool({
  name: 'addHandoff',
  description:
    'Crée une **transmission d’information entre deux swimlanes** : une étape « envoyé » dans la bande ' +
    'source et une étape « reçu » dans la bande destination, **alignées verticalement (même x)** et ' +
    'reliées. À utiliser à CHAQUE passage d’un acteur à un autre. Rédige les libellés au passé ' +
    '(« J’ai transmis… », « J’ai reçu… »). Retourne les ids créés.',
  schema: z.object({
    fromLaneId: z.string().min(1).describe('Bande source (id OU nom)'),
    toLaneId: z.string().min(1).describe('Bande destination (id OU nom)'),
    sent: z.string().min(1).describe('Libellé « envoyé » (bande source), au passé'),
    received: z.string().min(1).describe('Libellé « reçu » (bande destination), au passé'),
    sentId: z.string().optional().describe('Id stable de l’étape « envoyé » (slug, sinon auto)'),
    receivedId: z.string().optional().describe('Id stable de l’étape « reçu » (slug, sinon auto)'),
    sentDescription: z.string().optional(),
    receivedDescription: z.string().optional(),
    x: finiteNum.optional().describe('Position x commune (auto à droite du flux si absent)'),
  }),
  run(ctx, a) {
    const from = resolveLaneId(ctx.engine, a.fromLaneId);
    if (!from) throw new Error(`Aucune bande source « ${a.fromLaneId} ».`);
    const to = resolveLaneId(ctx.engine, a.toLaneId);
    if (!to) throw new Error(`Aucune bande destination « ${a.toLaneId} ».`);
    const x = a.x !== undefined ? a.x : nextFlowX(ctx.engine);
    const sentId = claimOrGenId(ctx, a.sentId);
    ctx.engine.addElement(
      {
        kind: 'step',
        id: sentId,
        x,
        y: laneCenterY(ctx.engine, from, STEP_H),
        width: STEP_W,
        height: STEP_H,
        name: a.sent,
        textAlign: 'left',
        swimlaneId: from,
        ...(a.sentDescription ? { description: a.sentDescription, showDescription: true } : {}),
      },
      { select: false },
    );
    const receivedId = claimOrGenId(ctx, a.receivedId);
    ctx.engine.addElement(
      {
        kind: 'step',
        id: receivedId,
        x,
        y: laneCenterY(ctx.engine, to, STEP_H),
        width: STEP_W,
        height: STEP_H,
        name: a.received,
        textAlign: 'left',
        swimlaneId: to,
        ...(a.receivedDescription
          ? { description: a.receivedDescription, showDescription: true }
          : {}),
      },
      { select: false },
    );
    const connectorId = ctx.genId();
    ctx.engine.connect(connectorId, sentId, receivedId, { endArrow: true });
    ensureLanesWidth(ctx.engine);
    return {
      sentId,
      receivedId,
      connectorId,
      message: `🔀 Transmission « ${a.sent} » → « ${a.received} » (alignées verticalement).`,
    };
  },
});

// ————————————————————————————————————————————————————————————————————————————
// Swimlanes
// ————————————————————————————————————————————————————————————————————————————

const addSwimlane = defineTool({
  name: 'addSwimlane',
  description:
    'Ajoute une bande (swimlane) au board. Retourne son id. Choisis `laneType` : "user" pour un ' +
    'acteur HUMAIN (rôle/personne), "system" pour un système automatisé, "custom" seulement si ce ' +
    'n’est ni l’un ni l’autre (préciser alors `customType`).',
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe('Id stable choisi par toi (slug, ex. "rh"), réutilisable ensuite'),
    name: z.string().min(1),
    laneType: laneTypeEnum.optional().describe('user (humain) | system | custom'),
    customType: z.string().optional().describe('Libellé du type quand laneType=custom'),
    color: colorEnum.optional(),
  }),
  run(ctx, a) {
    const typePatch = {
      ...(a.laneType ? { laneType: a.laneType } : {}),
      ...(a.customType ? { customType: a.customType } : {}),
      ...(a.color ? { color: a.color } : {}),
    };
    // **Anti-duplicate**: a lane with the same name (or same provided id) already exists → it is
    // REUSED (and its type/color updated if needed) instead of creating a second one.
    const wantId = a.id?.trim();
    const existing = ctx.engine
      .listSwimlanes()
      .find(
        (l) =>
          l.name.trim().toLowerCase() === a.name.trim().toLowerCase() ||
          (wantId && l.id === wantId),
      );
    if (existing) {
      if (Object.keys(typePatch).length > 0) ctx.engine.updateSwimlane(existing.id, typePatch);
      return {
        id: existing.id,
        existed: true,
        message: `↩️ Bande « ${existing.name} » réutilisée.`,
      };
    }
    const id = wantId || ctx.genId();
    const order = ctx.engine.listSwimlanes().length;
    ctx.engine.addSwimlane({ id, name: a.name, order, ...typePatch });
    return { id, message: `➕ Bande « ${a.name} » ajoutée.` };
  },
});

const updateSwimlane = defineTool({
  name: 'updateSwimlane',
  description:
    'Modifie une bande (par id ou nom) : nom, type user/system/custom, couleur, et **hauteur** ' +
    '(`height`, unités monde) pour l’agrandir/la resserrer. Pour la **largeur** (partagée par toutes ' +
    'les bandes), utilise `setLanesWidth`.',
  schema: z.object({
    id: z.string().min(1).describe('Id OU nom de la bande'),
    name: z.string().optional(),
    laneType: laneTypeEnum.optional().describe('user (humain) | system | custom'),
    customType: z.string().optional(),
    color: colorEnum.optional(),
    height: positiveNum
      .optional()
      .describe(
        'Hauteur de la bande (unités monde) — augmente pour aérer / faire tenir des cartes',
      ),
  }),
  run(ctx, a) {
    const laneId = resolveLaneId(ctx.engine, a.id);
    if (!laneId) throw new Error(`Aucune bande « ${a.id} ».`);
    const patch = {
      ...(a.name !== undefined ? { name: a.name } : {}),
      ...(a.laneType !== undefined ? { laneType: a.laneType } : {}),
      ...(a.customType !== undefined ? { customType: a.customType } : {}),
      ...(a.color !== undefined ? { color: a.color } : {}),
      ...(a.height !== undefined ? { height: a.height } : {}),
    };
    if (!ctx.engine.updateSwimlane(laneId, patch)) throw new Error('Mise à jour impossible.');
    // Changing the height shifts the lanes below → recenter the attached cards (otherwise they
    // leave their lane) and re-route the connectors.
    let recentered = 0;
    if (a.height !== undefined) {
      recentered = recenterAssignedSteps(ctx.engine);
      ctx.engine.refreshConnectors();
    }
    return {
      ok: true,
      ...(a.height !== undefined ? { recentered } : {}),
      message: `✏️ Bande mise à jour${a.height !== undefined ? ` (hauteur ${Math.round(a.height)})` : ''}.`,
    };
  },
});

const setLanesWidth = defineTool({
  name: 'setLanesWidth',
  description:
    'Définit la largeur (unités monde) d’un **groupe de bandes** : élargit le board vers la droite ' +
    '(chronologie) ou le resserre. Par défaut cible le groupe principal ; `laneRef` (id OU nom d’une ' +
    'bande) permet de cibler un autre groupe. La largeur ne descend jamais sous ce qu’il faut pour ' +
    'contenir les étapes du groupe (pas de carte coupée).',
  schema: z.object({
    width: positiveNum.describe('Largeur du groupe de bandes (unités monde)'),
    laneRef: z
      .string()
      .optional()
      .describe('Bande d’un groupe à redimensionner (défaut : le groupe principal)'),
  }),
  run(ctx, a) {
    const clusterId = a.laneRef
      ? resolveClusterId(ctx.engine, a.laneRef)
      : ctx.engine.listSwimlaneClusters()[0]?.id;
    if (!clusterId) throw new Error('Aucune bande à redimensionner.');
    const cluster = ctx.engine.getSwimlaneCluster(clusterId);
    // Floor: never cut a card in this cluster (relative to the cluster's left edge).
    const steps = stepsInCluster(ctx.engine, clusterId);
    const rightEdge = steps.length ? steps.reduce((m, s) => Math.max(m, s.x + s.width), 0) : 0;
    const needed = steps.length ? rightEdge - (cluster?.x ?? 0) + 120 : 0;
    const width = Math.max(a.width, needed);
    ctx.engine.updateSwimlaneCluster(clusterId, { width });
    return {
      ok: true,
      width: Math.round(width),
      clamped: width !== a.width,
      message: `↔️ Largeur du groupe : ${Math.round(width)}${width !== a.width ? ' (élargie pour ne pas couper de carte)' : ''}.`,
    };
  },
});

const reorderSwimlane = defineTool({
  name: 'reorderSwimlane',
  description:
    'Réordonne une bande (swimlane) **verticalement au sein de son groupe** (l’ordre de haut en bas). ' +
    'Donne `laneId` (id OU nom) et SOIT `toIndex` (position 0-based DANS le groupe, 0 = tout en haut), ' +
    'SOIT `before`/`after` (id OU nom d’une AUTRE bande **du même groupe**). Les cartes suivent leur ' +
    'bande. Pour déplacer une bande dans UN AUTRE groupe, utilise `attachSwimlane`. Ex. « mets Système ' +
    'en premier » → toIndex 0 ; « mets RH au-dessus de Manager » → before="Manager".',
  schema: z.object({
    laneId: z.string().min(1).describe('Bande à déplacer (id OU nom)'),
    toIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Position 0-based dans le groupe (0 = haut). Ignoré si before/after fourni.'),
    before: z
      .string()
      .optional()
      .describe('Placer JUSTE AU-DESSUS de cette bande du même groupe (id OU nom)'),
    after: z
      .string()
      .optional()
      .describe('Placer JUSTE AU-DESSOUS de cette bande du même groupe (id OU nom)'),
  }),
  run(ctx, a) {
    const laneId = resolveLaneId(ctx.engine, a.laneId);
    if (!laneId) throw new Error(`Aucune bande « ${a.laneId} ».`);
    const lanes = ctx.engine.listSwimlanes();
    const lane = lanes.find((l) => l.id === laneId)!;
    const name = lane.name || laneId;
    // Reorder is WITHIN the lane's own cluster (group). `others` = same-group lanes minus the moved
    // one; the engine's target index is the insertion index in this list.
    const others = lanes.filter((l) => l.clusterId === lane.clusterId && l.id !== laneId);

    let target: number;
    const ref = a.before ?? a.after;
    if (ref !== undefined) {
      const refId = resolveLaneId(ctx.engine, ref);
      if (!refId) throw new Error(`Aucune bande « ${ref} ».`);
      if (refId === laneId)
        return { ok: false, message: 'Référence = la bande elle-même : inchangé.' };
      const refIdx = others.findIndex((l) => l.id === refId);
      if (refIdx === -1)
        throw new Error(
          `« ${ref} » n’est pas dans le même groupe que « ${name} » — utilise attachSwimlane pour changer de groupe.`,
        );
      target = a.before !== undefined ? refIdx : refIdx + 1;
    } else if (a.toIndex !== undefined) {
      target = a.toIndex;
    } else {
      throw new Error('Fournis `toIndex`, `before` ou `after`.');
    }

    const ok = ctx.engine.reorderSwimlane(laneId, target);
    return {
      ok,
      order: ctx.engine
        .listSwimlanes()
        .filter((l) => l.clusterId === lane.clusterId)
        .map((l) => l.name || l.id),
      message: ok ? `↕️ Bande « ${name} » réordonnée.` : `Ordre inchangé pour « ${name} ».`,
    };
  },
});

const deleteSwimlane = defineTool({
  name: 'deleteSwimlane',
  description: 'Supprime une bande (par id ou nom). Les étapes rattachées ne sont pas supprimées.',
  destructive: true,
  schema: z.object({ id: z.string().min(1).describe('Id OU nom de la bande') }),
  run(ctx, a) {
    const laneId = resolveLaneId(ctx.engine, a.id);
    if (!laneId || !ctx.engine.removeSwimlane(laneId)) throw new Error(`Aucune bande « ${a.id} ».`);
    return { ok: true, message: `🗑️ Bande supprimée.` };
  },
});

const moveSwimlaneGroup = defineTool({
  name: 'moveSwimlaneGroup',
  description:
    'Déplace un GROUPE de bandes liées (cluster) dans le plan : toutes ses bandes ET les cartes ' +
    'qu’elles contiennent bougent ensemble. Désigne le groupe par `laneRef` (id OU nom d’une bande du ' +
    'groupe). Donne SOIT un déplacement relatif `dx`/`dy`, SOIT une position absolue `x`/`y` du coin ' +
    'haut-gauche du bloc.',
  schema: z.object({
    laneRef: z.string().min(1).describe('Id OU nom d’une bande du groupe à déplacer'),
    dx: finiteNum.optional().describe('Déplacement horizontal (unités monde)'),
    dy: finiteNum.optional().describe('Déplacement vertical (unités monde)'),
    x: finiteNum.optional().describe('Position absolue x du coin haut-gauche (prime sur dx)'),
    y: finiteNum.optional().describe('Position absolue y du coin haut-gauche (prime sur dy)'),
  }),
  run(ctx, a) {
    if (a.dx === undefined && a.dy === undefined && a.x === undefined && a.y === undefined)
      throw new Error('Fournis `dx`/`dy` ou `x`/`y`.');
    const clusterId = resolveClusterId(ctx.engine, a.laneRef);
    if (!clusterId) throw new Error(`Aucune bande « ${a.laneRef} ».`);
    const cluster = ctx.engine.getSwimlaneCluster(clusterId);
    if (!cluster) throw new Error('Groupe introuvable.');
    const dx = a.x !== undefined ? a.x - cluster.x : (a.dx ?? 0);
    const dy = a.y !== undefined ? a.y - cluster.y : (a.dy ?? 0);
    const targetX = cluster.x + dx;
    const targetY = cluster.y + dy;
    // A zero delta means the group is ALREADY at the requested position — a success, not a failure.
    if (dx === 0 && dy === 0)
      return {
        ok: true,
        x: Math.round(targetX),
        y: Math.round(targetY),
        message: `↔️ Groupe déjà en (${Math.round(targetX)}, ${Math.round(targetY)}).`,
      };
    ctx.engine.moveCluster(clusterId, dx, dy);
    // Report the real final position; fall back to the computed target (never a fabricated (0,0)).
    const now = ctx.engine.getSwimlaneCluster(clusterId);
    const finalX = Math.round(now?.x ?? targetX);
    const finalY = Math.round(now?.y ?? targetY);
    return {
      ok: true,
      x: finalX,
      y: finalY,
      message: `↔️ Groupe déplacé en (${finalX}, ${finalY}).`,
    };
  },
});

const detachSwimlane = defineTool({
  name: 'detachSwimlane',
  description:
    'Détache une bande de son groupe pour en faire un bloc autonome, posé en (`x`,`y`) (coin ' +
    'haut-gauche). La bande emporte les cartes qu’elle contient. Sans effet si la bande est déjà ' +
    'seule dans son groupe.',
  schema: z.object({
    laneRef: z.string().min(1).describe('Id OU nom de la bande à détacher'),
    x: finiteNum.describe('Position x du bloc détaché (unités monde)'),
    y: finiteNum.describe('Position y du bloc détaché (unités monde)'),
  }),
  run(ctx, a) {
    const laneId = resolveLaneId(ctx.engine, a.laneRef);
    if (!laneId) throw new Error(`Aucune bande « ${a.laneRef} ».`);
    const ok = ctx.engine.detachSwimlaneTo(laneId, a.x, a.y);
    return {
      ok,
      message: ok
        ? `✂️ Bande détachée en (${Math.round(a.x)}, ${Math.round(a.y)}).`
        : 'Bande déjà seule dans son groupe : inchangé.',
    };
  },
});

const attachSwimlane = defineTool({
  name: 'attachSwimlane',
  description:
    'Ré-aimante une bande dans le groupe d’une autre bande : elle adopte l’alignement (bord gauche + ' +
    'largeur) du groupe d’accueil et s’y empile. `laneRef` = bande à déplacer ; `targetRef` = une bande ' +
    'du groupe d’accueil (id OU nom). `atIndex` optionnel = position dans la pile (0 = en haut, défaut = en bas).',
  schema: z.object({
    laneRef: z.string().min(1).describe('Id OU nom de la bande à rattacher'),
    targetRef: z.string().min(1).describe('Id OU nom d’une bande du groupe d’accueil'),
    atIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Position dans la pile du groupe (0 = haut ; défaut = en bas)'),
  }),
  run(ctx, a) {
    const laneId = resolveLaneId(ctx.engine, a.laneRef);
    if (!laneId) throw new Error(`Aucune bande « ${a.laneRef} ».`);
    const targetClusterId = resolveClusterId(ctx.engine, a.targetRef);
    if (!targetClusterId) throw new Error(`Aucune bande « ${a.targetRef} ».`);
    const ok = ctx.engine.attachSwimlane(laneId, targetClusterId, a.atIndex);
    return {
      ok,
      message: ok
        ? `🧲 Bande ré-aimantée au groupe de « ${a.targetRef} ».`
        : 'Rattachement impossible (bande déjà dans ce groupe ?).',
    };
  },
});

// ————————————————————————————————————————————————————————————————————————————
// Free shapes + meta
// ————————————————————————————————————————————————————————————————————————————

const addShape = defineTool({
  name: 'addShape',
  description: 'Ajoute une forme libre (annotation hors process) : rectangle, ellipse ou texte.',
  schema: z.object({
    id: z.string().optional().describe('Id stable choisi par toi (slug), réutilisable ensuite'),
    kind: z.enum(['rectangle', 'ellipse', 'text']),
    text: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  run(ctx, a) {
    const id = claimElementId(ctx, a.id);
    const dims = SHAPE_DIMS[a.kind];
    const pos = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : { x: 80, y: 80 };
    ctx.engine.addElement(
      { kind: a.kind, id, x: pos.x, y: pos.y, ...dims, ...(a.text ? { text: a.text } : {}) },
      { select: false },
    );
    return { id, message: `➕ ${a.kind}${a.text ? ` « ${a.text} »` : ''} ajouté.` };
  },
});

const updateShape = defineTool({
  name: 'updateShape',
  description:
    'Modifie une forme libre (rectangle/ellipse/texte) par id : texte, mise en forme, apparence ' +
    '(couleurs/ombre/opacité), taille/position. Pour les étapes, utilise updateStep.',
  schema: z.object({
    id: z.string().min(1),
    text: z.string().optional(),
    ...textFormatShape,
    ...appearanceShape,
    ...geometryShape,
  }),
  run(ctx, a) {
    const el = ctx.engine.board.getElement(a.id);
    if (!el || (el.kind !== 'rectangle' && el.kind !== 'ellipse' && el.kind !== 'text')) {
      throw new Error(`Aucune forme (rectangle/ellipse/texte) avec l'id ${a.id}.`);
    }
    const patch: ElementPatch = {
      ...(a.text !== undefined ? { text: a.text } : {}),
      ...stylePatch(a),
    };
    if (!ctx.engine.updateElement(a.id, patch)) throw new Error('Mise à jour impossible.');
    if (geomChanged(a)) ctx.engine.refreshConnectors();
    return { ok: true, message: '✏️ Forme mise à jour.' };
  },
});

const setBoardName = defineTool({
  name: 'setBoardName',
  description: 'Renomme le board.',
  schema: z.object({ name: z.string().min(1) }),
  run(ctx, a) {
    ctx.engine.setName(a.name);
    return { ok: true, message: `✏️ Board renommé « ${a.name} ».` };
  },
});

const setBoardBackground = defineTool({
  name: 'setBoardBackground',
  description: 'Change la couleur de fond du board (token ui-kit ou couleur CSS).',
  schema: z.object({ color: z.string().min(1) }),
  run(ctx, a) {
    ctx.engine.setBackground(a.color);
    return { ok: true, message: `🎨 Fond mis à jour.` };
  },
});

const getBoardState = defineTool({
  name: 'getBoardState',
  description:
    "Retourne l'état courant du board (étapes, liens, bandes). À utiliser pour resynchroniser au besoin.",
  schema: z.object({}),
  run(ctx) {
    return { ...summarizeBoard(ctx.engine), message: 'État du board lu.' };
  },
});

/** Full registry, in the order exposed to the model. */
export const TOOLS: readonly ToolDef[] = [
  addStep,
  updateStep,
  moveStepToLane,
  deleteElement,
  connectSteps,
  connectFlow,
  tidyFlow,
  tidyLayout,
  disconnectSteps,
  addHandoff,
  addSwimlane,
  updateSwimlane,
  setLanesWidth,
  reorderSwimlane,
  moveSwimlaneGroup,
  detachSwimlane,
  attachSwimlane,
  deleteSwimlane,
  addShape,
  updateShape,
  setBoardName,
  setBoardBackground,
  getBoardState,
];

/** Index by name (O(1) lookup in the dispatcher). */
export const TOOLS_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOLS.map((t) => [t.name, t]));
