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
 * Reuses the exported domain schema (`BOARD_TYPES`, the engine's validated writes) — it never
 * redeclares element shapes. First slice: `read_board`, `add_step`, `connect`, `set_board_type`.
 */
import { z } from 'zod';
import type { WhiteboardEngine } from './engine.js';
import { BOARD_TYPES, type BoardType, type Scene } from './scene.js';

/** Default size (world units) of a step card created by {@link addStep} when unspecified. */
const DEFAULT_STEP_WIDTH = 220;
const DEFAULT_STEP_HEIGHT = 120;

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

/** The catalog of provider-neutral agent operations exposed by this build. */
export const AGENT_OPS: readonly AgentOp[] = [readBoard, addStep, connect, setBoardType];

/** Looks an op up by its {@link AgentOp.name}, or `undefined` when unknown. */
export function getAgentOp(name: string): AgentOp | undefined {
  return AGENT_OPS.find((op) => op.name === name);
}
