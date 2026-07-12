/**
 * Agent operations — a **provider-neutral** catalog of high-level board edits, meant to be exposed
 * as tools to an LLM agent by a host (e.g. mapped to a function-calling schema). Each op is a
 * `{ name, description, inputSchema, run }` quadruple over a {@link WhiteboardEngine}:
 *
 *  - **headless** — no DOM, no React (the engine is DOM-free), so a Node backend can import it;
 *  - **provider-neutral** — knows nothing about any specific LLM, host, approval flow or transport.
 *    A host validates raw tool input with `inputSchema`, calls `run`, and maps the return value back;
 *  - **validated boundary** — `run` parses its input through `inputSchema` before touching the board,
 *    so a malformed tool call throws {@link AgentOpError} instead of corrupting state.
 *
 * Reuses the exported domain schema (`BOARD_TYPES`, `SWIMLANE_COLORS`, the engine's validated
 * writes) — it never redeclares element shapes. Catalog: reads (`read_board`), a process-oriented
 * layer (`add_step`, `connect`, `set_board_type`, `link_subprocess`, `unlink_subprocess`) and a
 * full element CRUD (`add_element`, `add_swimlane`, `update_swimlane`, `delete_swimlane`,
 * `add_group`, `move_element`, `update_element`, `delete_element`).
 */
import { z } from 'zod';
import type { WhiteboardEngine } from './engine.js';
import {
  BOARD_TYPES,
  SUBPROCESS_KINDS,
  SWIMLANE_COLORS,
  type BoardType,
  type Scene,
} from './scene.js';

/** Default size (world units) of a step card created by {@link addStep} when unspecified. */
const DEFAULT_STEP_WIDTH = 220;
const DEFAULT_STEP_HEIGHT = 120;

/** Default size (world units) of a free shape created by {@link addElement} when unspecified. */
const DEFAULT_SHAPE_WIDTH = 120;
const DEFAULT_SHAPE_HEIGHT = 80;

/** Thrown by {@link AgentOp.run} on invalid input or an impossible operation (e.g. missing endpoint). */
export class AgentOpError extends Error {
  override readonly name = 'AgentOpError';
}

/**
 * A single agent-facing operation. `Output` is the JSON-serializable value a host returns to the
 * model (e.g. `{ id }` for a create). The input type is intentionally erased at this interface —
 * `inputSchema` is the source of truth and `run` validates against it — so a heterogeneous catalog
 * (`AgentOp[]`) stays assignable without variance friction.
 */
export interface AgentOp<Output = unknown> {
  /** Stable tool name (host maps it to its function-calling name, e.g. `whiteboard__add_step`). */
  readonly name: string;
  /** One-line, model-facing description of what the op does and what it returns. */
  readonly description: string;
  /** zod schema for the tool input; a host can derive its own function-calling schema from it. */
  readonly inputSchema: z.ZodType;
  /** Validate `rawInput` against {@link inputSchema}, then apply the op to `engine`. */
  run(engine: WhiteboardEngine, rawInput: unknown): Output;
}

/**
 * Builds a typed op from a spec: `execute` receives the **validated** input (`z.infer` of the
 * schema), while the returned `run` handles parse-then-execute and wraps a validation failure in a
 * typed {@link AgentOpError}. Keeps the input type internal (inference) while the public interface
 * stays `AgentOp<Output>`.
 */
function defineOp<S extends z.ZodType, Output>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  execute: (engine: WhiteboardEngine, input: z.infer<S>) => Output;
}): AgentOp<Output> {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    run(engine, rawInput) {
      const result = spec.inputSchema.safeParse(rawInput);
      if (!result.success) {
        throw new AgentOpError(`Invalid input for "${spec.name}": ${result.error.message}`);
      }
      return spec.execute(engine, result.data);
    },
  };
}

let idSeq = 0;
/**
 * Fresh opaque id for a created element (`<prefix>:<id>`). Uses `crypto.randomUUID` when available
 * (Node ≥ 19, browsers) with a timestamp+counter fallback for older runtimes. Ids are host-opaque;
 * a host/test can also pass an explicit `id` to an op for deterministic output.
 */
function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
  return `${prefix}:${rand}`;
}

const readBoard = defineOp({
  name: 'read_board',
  description:
    'Return the whole board as a lossless snapshot (board type, every element with its id, ' +
    'swimlanes, groups). Call this first to see what exists and to obtain element ids before editing.',
  inputSchema: z.object({}),
  execute: (engine): Scene => engine.board.toScene(),
});

const addStep = defineOp({
  name: 'add_step',
  description:
    'Add a process step (card) at world coordinates (top-left corner). Returns the new element ' +
    'id — reuse it with `connect`.',
  inputSchema: z.object({
    name: z.string().min(1).describe('Step title shown on the card.'),
    x: z.number().finite().describe('World x of the top-left corner.'),
    y: z.number().finite().describe('World y of the top-left corner.'),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    description: z.string().optional(),
    swimlaneId: z
      .string()
      .min(1)
      .optional()
      .describe('Attach the step to this swimlane, if given.'),
    id: z.string().min(1).optional().describe('Explicit element id (else one is generated).'),
  }),
  execute: (engine, input): { id: string } => {
    const id = input.id ?? newId('step');
    engine.addElement(
      {
        kind: 'step',
        id,
        x: input.x,
        y: input.y,
        width: input.width ?? DEFAULT_STEP_WIDTH,
        height: input.height ?? DEFAULT_STEP_HEIGHT,
        name: input.name,
        // Respect exactOptionalPropertyTypes: only include an optional field when actually provided.
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.swimlaneId !== undefined ? { swimlaneId: input.swimlaneId } : {}),
      },
      { select: false },
    );
    return { id };
  },
});

const connect = defineOp({
  name: 'connect',
  description:
    'Draw a directed arrow from one element to another; both must already exist (use ids from ' +
    '`read_board` or `add_step`). The arrow stays bound and re-routes when either end moves. ' +
    'Returns the new connector id.',
  inputSchema: z.object({
    from: z.string().min(1).describe('Source element id.'),
    to: z.string().min(1).describe('Target element id.'),
    id: z.string().min(1).optional().describe('Explicit connector id (else one is generated).'),
  }),
  execute: (engine, input): { id: string } => {
    const id = input.id ?? newId('arrow');
    const created = engine.connect(id, input.from, input.to, { endArrow: true });
    if (!created) {
      throw new AgentOpError(
        `Cannot connect: element "${input.from}" or "${input.to}" does not exist.`,
      );
    }
    return { id };
  },
});

const setBoardType = defineOp({
  name: 'set_board_type',
  description:
    'Set the board type: one of process, architecture, ideation (scene-level classification).',
  inputSchema: z.object({ boardType: z.enum(BOARD_TYPES) }),
  execute: (engine, input): { boardType: BoardType } => {
    engine.setBoardType(input.boardType);
    return { boardType: input.boardType };
  },
});

const linkSubprocess = defineOp({
  name: 'link_subprocess',
  description:
    'Link a process (another whiteboard document) to a step: the step shows a badge and humans ' +
    'can open the linked process from it (double-click / side panel). `ref` is the host document ' +
    'id of the target whiteboard. `kind` is an indicative label only: "sub" (nested sub-process, ' +
    'the default) or "external" (a process living elsewhere). Returns the step id.',
  inputSchema: z.object({
    id: z.string().min(1).describe('Id of the step to link (see `read_board`).'),
    ref: z.string().min(1).describe('Host document id of the whiteboard to link.'),
    kind: z
      .enum(SUBPROCESS_KINDS)
      .optional()
      .describe('Indicative kind of the link: "sub" (default) or "external".'),
  }),
  execute: (engine, input): { id: string } => {
    // `subprocessRef`/`subprocessKind` only exist on steps; on any other kind the zod merge in
    // `updateElement` would silently STRIP the unknown key — guard here so the model gets a typed
    // error instead of a write that looks applied but is not.
    const element = engine.board.getElement(input.id);
    if (!element) {
      throw new AgentOpError(`Element "${input.id}" not found.`);
    }
    if (element.kind !== 'step') {
      throw new AgentOpError(
        `Element "${input.id}" is not a step — only steps can link a process.`,
      );
    }
    engine.updateElement(input.id, {
      subprocessRef: input.ref,
      // Respect exactOptionalPropertyTypes: only touch the kind when actually provided (a re-link
      // without `kind` keeps the current label).
      ...(input.kind !== undefined ? { subprocessKind: input.kind } : {}),
    });
    return { id: input.id };
  },
});

const unlinkSubprocess = defineOp({
  name: 'unlink_subprocess',
  description:
    'Remove the process link of a step (the step itself and the linked document are kept). ' +
    'Returns the step id.',
  inputSchema: z.object({
    id: z.string().min(1).describe('Id of the step to unlink (see `read_board`).'),
  }),
  execute: (engine, input): { id: string } => {
    const element = engine.board.getElement(input.id);
    if (!element) {
      throw new AgentOpError(`Element "${input.id}" not found.`);
    }
    if (element.kind !== 'step') {
      throw new AgentOpError(
        `Element "${input.id}" is not a step — only steps can link a process.`,
      );
    }
    // An unlink on a step without a link would "succeed" without changing anything — surface it
    // to the model instead (same contract as an id-only update_swimlane).
    if (!element.subprocessRef) {
      throw new AgentOpError(`Step "${input.id}" has no linked process.`);
    }
    engine.updateElement(input.id, { subprocessRef: null, subprocessKind: null });
    return { id: input.id };
  },
});

const addElement = defineOp({
  name: 'add_element',
  description:
    'Add a free annotation shape (rectangle, ellipse or a plain text label) at world coordinates ' +
    '(top-left corner). For a process node use `add_step` instead. Returns the new element id — ' +
    'reuse it with `connect`, `move_element`, `update_element` or `delete_element`.',
  inputSchema: z.object({
    kind: z
      .enum(['rectangle', 'ellipse', 'text'])
      .describe('Shape to create: a box, an ellipse or a plain text label.'),
    x: z.number().finite().describe('World x of the top-left corner.'),
    y: z.number().finite().describe('World y of the top-left corner.'),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    text: z.string().optional().describe('Text label shown inside/for the element.'),
    id: z.string().min(1).optional().describe('Explicit element id (else one is generated).'),
  }),
  execute: (engine, input): { id: string } => {
    // A text element has no shape fallback: the engine's `textSchema` requires `text`. Guard here so a
    // missing label fails as an `AgentOpError` (this op's contract) instead of leaking the engine's
    // `WhiteboardParseError`. Rectangles and ellipses keep `text` optional.
    if (input.kind === 'text' && (input.text === undefined || input.text === '')) {
      throw new AgentOpError('A text element requires a non-empty `text`.');
    }
    const id = input.id ?? newId('el');
    engine.addElement(
      {
        kind: input.kind,
        id,
        x: input.x,
        y: input.y,
        width: input.width ?? DEFAULT_SHAPE_WIDTH,
        height: input.height ?? DEFAULT_SHAPE_HEIGHT,
        // Respect exactOptionalPropertyTypes: only include an optional field when actually provided.
        ...(input.text !== undefined ? { text: input.text } : {}),
      },
      { select: false },
    );
    return { id };
  },
});

const addSwimlane = defineOp({
  name: 'add_swimlane',
  description:
    'Add a swimlane (horizontal organizational band) to the process board. Returns the new lane ' +
    'id — pass it as `add_step`’s `swimlaneId` to place a step inside it.',
  inputSchema: z.object({
    name: z.string().optional().describe('Lane label.'),
    laneType: z
      .enum(['user', 'system', 'custom'])
      .optional()
      .describe('Lane category: actor (user), system or free (custom).'),
    color: z.enum(SWIMLANE_COLORS).optional().describe('Semantic lane color.'),
    id: z.string().min(1).optional().describe('Explicit lane id (else one is generated).'),
  }),
  execute: (engine, input): { id: string } => {
    const id = input.id ?? newId('lane');
    const lane = engine.addSwimlane({
      id,
      // Respect exactOptionalPropertyTypes: only include an optional field when actually provided.
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.laneType !== undefined ? { laneType: input.laneType } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    });
    return { id: lane.id };
  },
});

const updateSwimlane = defineOp({
  name: 'update_swimlane',
  description:
    'Update fields of an existing swimlane: its name, category (`laneType`, with `customType` as ' +
    'the free label when "custom"), semantic color, height or width. Only the provided fields ' +
    'change — the same edits as the interactive panel and canvas handles. Note: lanes of a block ' +
    'share their width (a cluster property), so `width` widens every aligned lane. Returns the ' +
    'lane id.',
  inputSchema: z
    .object({
      id: z.string().min(1).describe('Id of the swimlane to update (see `read_board`).'),
      name: z.string().optional().describe('New lane label.'),
      laneType: z
        .enum(['user', 'system', 'custom'])
        .optional()
        .describe('New lane category: actor (user), system or free (custom).'),
      customType: z
        .string()
        .optional()
        .describe('Free category label, shown when `laneType` is "custom".'),
      color: z.enum(SWIMLANE_COLORS).optional().describe('New semantic lane color.'),
      // Same lower bound as the interactive panel (side-panel `min={60}` + `h >= 60` guard).
      height: z
        .number()
        .finite()
        .min(60)
        .optional()
        .describe('New lane height (world units, minimum 60).'),
      // Same lower bound as the canvas width-resize handle (`Math.max(200, …)`). Width lives on
      // the lane's CLUSTER (shared by every aligned lane) — resolved from the lane id below.
      width: z
        .number()
        .finite()
        .min(200)
        .optional()
        .describe('New width of the lane block (world units, minimum 200, shared by its lanes).'),
    })
    .describe('The id plus at least one field to change.'),
  execute: (engine, input): { id: string } => {
    // Build the lane-level patch with only the provided fields (respect exactOptionalPropertyTypes).
    const patch: Parameters<WhiteboardEngine['updateSwimlane']>[1] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.laneType !== undefined) patch.laneType = input.laneType;
    if (input.customType !== undefined) patch.customType = input.customType;
    if (input.color !== undefined) patch.color = input.color;
    if (input.height !== undefined) patch.height = input.height;
    // An empty patch would "succeed" without changing anything — surface it to the model instead.
    if (Object.keys(patch).length === 0 && input.width === undefined) {
      throw new AgentOpError('update_swimlane requires at least one field to change besides `id`.');
    }
    // `width` is a property of the lane's cluster (shared by every aligned lane): resolve it from
    // the lane. Resolving also covers the width-only call, where `updateSwimlane` is skipped.
    const lane = engine.listSwimlanes().find((l) => l.id === input.id);
    if (!lane) {
      throw new AgentOpError(`Swimlane "${input.id}" not found.`);
    }
    // One transaction for the lane patch + the cluster width: a peer must never observe one
    // without the other (same atomicity contract as the engine's own multi-write commits).
    engine.board.transact(() => {
      if (Object.keys(patch).length > 0) engine.updateSwimlane(input.id, patch);
      if (input.width !== undefined) {
        engine.updateSwimlaneCluster(lane.clusterId, { width: input.width });
      }
      // A geometry change (height reflows the lanes below, width moves the right edge) must
      // re-route bound connectors — the canvas handles do the same after a drag (cf. 0.8.1).
      if (input.height !== undefined || input.width !== undefined) engine.refreshConnectors();
    });
    return { id: input.id };
  },
});

const deleteSwimlane = defineOp({
  name: 'delete_swimlane',
  description:
    'Delete an existing swimlane by id. Steps are NOT deleted with the lane (they keep their ' +
    'position on the board). Use `read_board` to obtain the id first. Returns the deleted lane id.',
  inputSchema: z.object({
    id: z.string().min(1).describe('Id of the swimlane to delete.'),
  }),
  execute: (engine, input): { id: string } => {
    if (!engine.removeSwimlane(input.id)) {
      throw new AgentOpError(`Swimlane "${input.id}" not found.`);
    }
    return { id: input.id };
  },
});

const addGroup = defineOp({
  name: 'add_group',
  description:
    'Add a named group over process steps (e.g. an "agent" grouping). `stepIds` are the ids of the ' +
    'steps it encloses (they can be added later by editing the board). Returns the new group id.',
  inputSchema: z.object({
    name: z.string().optional().describe('Group label.'),
    stepIds: z.array(z.string()).optional().describe('Ids of the steps the group encloses.'),
    id: z.string().min(1).optional().describe('Explicit group id (else one is generated).'),
  }),
  execute: (engine, input): { id: string } => {
    const id = input.id ?? newId('group');
    const group = engine.board.addAgentGroup({
      id,
      // Respect exactOptionalPropertyTypes: only include an optional field when actually provided.
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.stepIds !== undefined ? { stepIds: input.stepIds } : {}),
    });
    return { id: group.id };
  },
});

const moveElement = defineOp({
  name: 'move_element',
  description:
    'Move an existing element by a **relative** delta (dx, dy) in world units. Use `read_board` to ' +
    'obtain the id first. Returns the moved element id.',
  inputSchema: z.object({
    id: z.string().min(1).describe('Id of the element to move.'),
    dx: z.number().finite().describe('Horizontal delta (world units).'),
    dy: z.number().finite().describe('Vertical delta (world units).'),
  }),
  execute: (engine, input): { id: string } => {
    if (!engine.moveElement(input.id, input.dx, input.dy)) {
      throw new AgentOpError(`Element "${input.id}" not found.`);
    }
    // Bound connectors store their routed points; re-route them so an arrow ALWAYS follows the moved
    // element (the interactive layer does the same after a drag). A link must never lag behind.
    engine.refreshConnectors();
    return { id: input.id };
  },
});

const updateElement = defineOp({
  name: 'update_element',
  description:
    'Update fields of an existing element: its text label, an **absolute** position (x, y), size ' +
    '(width, height) or colors (fill, stroke). Only the provided fields change. Use `move_element` ' +
    'for a relative move. Returns the element id.',
  inputSchema: z
    .object({
      id: z.string().min(1).describe('Id of the element to update.'),
      text: z.string().optional().describe('New text label.'),
      x: z.number().finite().optional().describe('New absolute world x (top-left corner).'),
      y: z.number().finite().optional().describe('New absolute world y (top-left corner).'),
      width: z.number().finite().positive().optional(),
      height: z.number().finite().positive().optional(),
      fill: z.string().min(1).optional().describe('Fill color (ui-kit token or CSS value).'),
      stroke: z.string().min(1).optional().describe('Stroke color (ui-kit token or CSS value).'),
    })
    .describe('The id plus at least one field to change.'),
  execute: (engine, input): { id: string } => {
    // Build the patch with only the provided fields (respect exactOptionalPropertyTypes).
    const patch: Parameters<WhiteboardEngine['updateElement']>[1] = {};
    if (input.text !== undefined) patch.text = input.text;
    if (input.x !== undefined) patch.x = input.x;
    if (input.y !== undefined) patch.y = input.y;
    if (input.width !== undefined) patch.width = input.width;
    if (input.height !== undefined) patch.height = input.height;
    if (input.fill !== undefined) patch.fill = input.fill;
    if (input.stroke !== undefined) patch.stroke = input.stroke;
    if (!engine.updateElement(input.id, patch)) {
      throw new AgentOpError(`Element "${input.id}" not found.`);
    }
    // A geometry change (x/y/width/height) must re-route bound connectors — as after an interactive
    // move/resize. Cheap and idempotent when the patch only touched text/colors.
    engine.refreshConnectors();
    return { id: input.id };
  },
});

const deleteElement = defineOp({
  name: 'delete_element',
  description:
    'Delete an existing element by id (any kind — shape, text, step or connector). Use `read_board` ' +
    'to obtain the id first. Returns the deleted element id.',
  inputSchema: z.object({
    id: z.string().min(1).describe('Id of the element to delete.'),
  }),
  execute: (engine, input): { id: string } => {
    if (!engine.removeElement(input.id)) {
      throw new AgentOpError(`Element "${input.id}" not found.`);
    }
    return { id: input.id };
  },
});

/** The catalog of provider-neutral agent operations exposed by this build. */
export const AGENT_OPS: readonly AgentOp[] = [
  readBoard,
  addStep,
  connect,
  setBoardType,
  linkSubprocess,
  unlinkSubprocess,
  addElement,
  addSwimlane,
  updateSwimlane,
  deleteSwimlane,
  addGroup,
  moveElement,
  updateElement,
  deleteElement,
];

/** Looks an op up by its {@link AgentOp.name}, or `undefined` when unknown. */
export function getAgentOp(name: string): AgentOp | undefined {
  return AGENT_OPS.find((op) => op.name === name);
}
