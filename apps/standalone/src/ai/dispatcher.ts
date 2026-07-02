/**
 * **Dispatcher**: executes a `tool_call` emitted by the model on the engine, defensively.
 *
 * Guarantees:
 * - `arguments` (JSON string) parsed safely; unknown tool / invalid args → **error captured**,
 *   never a crash;
 * - **always** a `role:'tool'` message in return (success *or* error) → the model can self-correct.
 */
import { ZodError } from 'zod';
import type { ChatMessage, ToolCall } from './mistral-client.js';
import { TOOLS_BY_NAME, type ToolContext, type ToolResult } from './tools.js';

export interface DispatchOutcome {
  readonly toolCallId: string;
  readonly name: string;
  readonly success: boolean;
  readonly destructive: boolean;
  readonly result?: ToolResult;
  readonly error?: string;
}

/** Parses + validates + executes. Never throws: encodes the failure in `DispatchOutcome`. */
export function dispatchToolCall(ctx: ToolContext, call: ToolCall): DispatchOutcome {
  const name = call.function.name;
  const tool = TOOLS_BY_NAME.get(name);
  const base = { toolCallId: call.id, name, destructive: tool?.destructive ?? false };

  if (!tool) {
    return { ...base, success: false, error: `Outil inconnu : ${name}.` };
  }

  let rawArgs: unknown;
  try {
    const text = call.function.arguments?.trim();
    rawArgs = text ? JSON.parse(text) : {};
  } catch {
    return { ...base, success: false, error: 'Arguments JSON invalides.' };
  }

  try {
    const result = tool.run(ctx, rawArgs);
    return { ...base, success: true, result };
  } catch (err) {
    return { ...base, success: false, error: formatError(err) };
  }
}

/** Builds the `role:'tool'` message to send back to the model for a result. */
export function toolResultMessage(outcome: DispatchOutcome): ChatMessage {
  const payload = outcome.success
    ? (outcome.result ?? { ok: true })
    : { error: outcome.error ?? 'Erreur inconnue.' };
  return {
    role: 'tool',
    tool_call_id: outcome.toolCallId,
    content: JSON.stringify(payload),
  };
}

/** `role:'tool'` message signaling that a destructive action was refused by the user. */
export function declinedMessage(call: ToolCall): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: call.id,
    content: JSON.stringify({ error: 'Action refusée par l’utilisateur (non confirmée).' }),
  };
}

function formatError(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return first
      ? `Argument invalide : ${first.path.join('.')} — ${first.message}`
      : 'Arguments invalides.';
  }
  // `WhiteboardParseError` (engine validation) also carries zod `issues` → the faulty field is
  // surfaced so the model can self-correct ("y: Number must be finite", etc.).
  if (
    err instanceof Error &&
    'issues' in err &&
    Array.isArray((err as { issues?: unknown }).issues)
  ) {
    const issues = (err as { issues: Array<{ path?: Array<string | number>; message?: string }> })
      .issues;
    const first = issues[0];
    if (first)
      return `${err.message} (${(first.path ?? []).join('.')} : ${first.message ?? ''})`.trim();
  }
  if (err instanceof Error) return err.message;
  return 'Erreur inconnue.';
}
