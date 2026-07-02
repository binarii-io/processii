/**
 * Client-side **agent loop**. One user turn = chained Mistral calls while the model requests
 * tools; stops on a text reply or on `MAX_ITERATIONS` (anti-loop guard).
 *
 * The board mutates **during** the loop (each `tool_call` is executed immediately via the
 * engine) → the user sees the actions unfold. DOM-free and **testable**: `client` and `genId`
 * are injected (see `agent-loop.test.ts`). Destructive actions: `confirmDestructive` can refuse them.
 */
import { type ChatMessage, type MistralClient, type ToolCall } from './mistral-client.js';
import { dispatchToolCall, declinedMessage, toolResultMessage } from './dispatcher.js';
import { renderSummaryText, summarizeBoard } from './board-summary.js';
import { PROCESS_SKILL_PROMPT, processSkillActive } from './process-skill.js';
import { TOOLS, TOOLS_BY_NAME, type ToolContext, type ToolDef } from './tools.js';
import type { WhiteboardEngine } from '@binarii/processii';

// Cap on model ↔ tools round-trips **per turn**. Bounds a turn's cost/history growth; large-task
// coverage comes from the **auto-continuation** (the panel relaunches until the model concludes).
// Anti-loop guard: the model stops as soon as it replies with text.
export const MAX_ITERATIONS = 16;
export const DEFAULT_MODEL = 'mistral-small-latest';

/** Displayable action trace (feeds the panel's "✅ …" list). */
export interface ActionTrace {
  readonly message: string;
  readonly success: boolean;
}

export interface RunAgentLoopOptions {
  readonly client: MistralClient;
  readonly engine: WhiteboardEngine;
  /** History of the previous turns (user/assistant, text only). */
  readonly history: readonly ChatMessage[];
  /** User message of the current turn. */
  readonly userMessage: string;
  readonly model?: string;
  readonly maxIterations?: number;
  /** Permanent user instructions ("pre-prompt" / skills), injected into the system prompt. */
  readonly instructions?: string;
  /** Id generator for the created elements (default: `crypto.randomUUID`). */
  readonly genId?: () => string;
  /** Destructive-action confirmation; `false`/rejection → the action is refused and reported to the model. */
  readonly confirmDestructive?: (tool: ToolDef, call: ToolCall) => Promise<boolean> | boolean;
  /** Notified on each executed action (live trace). */
  readonly onAction?: (trace: ActionTrace) => void;
  /** Notified after each batch of mutations (forces the board re-render). */
  readonly onMutated?: () => void;
}

export interface AgentLoopResult {
  /** Final text reply of the assistant (may be `null` when absent). */
  readonly reply: string | null;
  /** Traces of the actions executed during the turn. */
  readonly actions: readonly ActionTrace[];
  readonly stoppedReason: 'done' | 'max-iterations';
}

function defaultGenId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  // Weakly-deterministic fallback (never in browser prod): enough for tests without `crypto`.
  return `id-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * System prompt: role, capabilities, **process skill** when relevant, possible **user
 * instructions**, and the board's **actual state**.
 */
export function buildSystemPrompt(
  engine: WhiteboardEngine,
  instructions?: string,
  processGuidance?: string,
): string {
  const summary = renderSummaryText(summarizeBoard(engine));
  const custom = instructions?.trim();
  const skill = processGuidance?.trim();
  return [
    "Tu es l'assistant d'édition d'un board de **modélisation de processus** (memorii Whiteboard).",
    'Tu modifies le board **uniquement** via les outils fournis. **TU CHOISIS toi-même les `id`** des',
    'éléments que tu crées : des slugs courts et STABLES (ex. "rh", "etape-signer-contrat"), et tu',
    'RÉUTILISES EXACTEMENT ces id pour connecter/éditer ensuite (jamais d’uuid inventé). Les bandes',
    '(swimlaneId) se réfèrent par id OU par nom. Crée les éléments avant de les connecter.',
    'Une « étape » (step) est une carte de processus (name, description, skills, deliverables,',
    'rattachement à une bande/swimlane).',
    'Le rattachement d’une étape à une bande est **géométrique** : pour la RANGER/DÉPLACER dans une bande,',
    'utilise `moveStepToLane` (poser `swimlaneId` seul ne déplace pas la carte). Redimensionne une bande',
    'avec `updateSwimlane(height)` / `setLanesWidth` ; `tidyLayout` range la mise en page. L’état du board',
    'ci-dessous inclut la géométrie (positions, bandes y top→bas) et signale les étapes hors de leur bande.',
    "N'ajoute **pas** d'émotion (badge happy/neutral/sad) à une étape sauf demande explicite de",
    "l'utilisateur : à la création, laisse les étapes **sans émotion**. Pour **retirer** l'émotion d'une",
    "étape existante, appelle updateStep avec emotion='none'.",
    'Réponds en français, brièvement, et termine par un court récapitulatif des actions effectuées.',
    ...(skill ? ['', skill] : []),
    ...(custom
      ? ['', 'Consignes permanentes de l’utilisateur (à respecter en priorité) :', custom]
      : []),
    '',
    'État actuel du board :',
    summary,
  ].join('\n');
}

/**
 * Runs one turn. Returns the final reply + the traces. Network/quota/key errors surface as
 * `MistralError` (to be presented by the UI); tool errors are sent back to the model (self-correction).
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const {
    client,
    engine,
    history,
    userMessage,
    model = DEFAULT_MODEL,
    maxIterations = MAX_ITERATIONS,
    instructions,
    genId = defaultGenId,
    confirmDestructive,
    onAction,
    onMutated,
  } = options;

  const ctx: ToolContext = { engine, genId };
  const tools = TOOLS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  // "Business process" skill: active when the message mentions it OR when the board already has swimlanes.
  const processGuidance = processSkillActive(userMessage, engine.listSwimlanes().length)
    ? PROCESS_SKILL_PROMPT
    : undefined;
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(engine, instructions, processGuidance) },
    ...history,
    { role: 'user', content: userMessage },
  ];
  const actions: ActionTrace[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const assistant = await client.complete({ model, messages, tools });
    messages.push(assistant);

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) {
      return { reply: assistant.content ?? null, actions, stoppedReason: 'done' };
    }

    let mutated = false;
    for (const call of calls) {
      const tool = TOOLS_BY_NAME.get(call.function.name);

      if (tool?.destructive && confirmDestructive) {
        const ok = await confirmDestructive(tool, call);
        if (!ok) {
          messages.push(declinedMessage(call));
          const trace: ActionTrace = {
            message: `⛔ Action annulée (${tool.name}).`,
            success: false,
          };
          actions.push(trace);
          onAction?.(trace);
          continue;
        }
      }

      const outcome = dispatchToolCall(ctx, call);
      messages.push(toolResultMessage(outcome));
      mutated = true;
      const trace: ActionTrace = {
        message: outcome.success
          ? (outcome.result?.message ?? `✅ ${outcome.name}`)
          : `⚠️ ${outcome.name} : ${outcome.error ?? 'échec'}`,
        success: outcome.success,
      };
      actions.push(trace);
      onAction?.(trace);
    }

    if (mutated) onMutated?.();
  }

  // Safety: iterations exhausted without a final text reply → stop cleanly.
  return {
    reply: `⏹️ Limite de sécurité atteinte (${maxIterations} étapes) pour ce tour. Réponds « continue » pour que je poursuive (je repars de l'état actuel du board), ou découpe la demande.`,
    actions,
    stoppedReason: 'max-iterations',
  };
}
