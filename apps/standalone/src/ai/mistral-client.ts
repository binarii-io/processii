/**
 * **Mistral** client (OpenAI-compatible chat/completions format), called **directly from the
 * browser** — the `api.mistral.ai` CORS allows it (see `docs/ai-chat-brief.md`). No backend.
 *
 * Intentionally minimal and **injectable**: `createMistralClient` takes a `fetch` and a
 * `baseUrl` (browser / prod defaults). The agent loop depends on the `MistralClient`
 * **interface**, which makes it testable without network (fake client scripting `tool_calls`).
 */

/** Tool exposed to the model (OpenAI/Mistral `tools` format). `parameters` = JSON Schema. */
export interface ToolSpec {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

/** Tool call emitted by the model. ⚠️ `arguments` is a **JSON string** (to parse). */
export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** Conversation message (`system` / `user` / `assistant` / `tool` roles). */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  /** Text; `null`/absent on an `assistant` turn that only calls tools. */
  readonly content?: string | null;
  /** Present on an `assistant` turn calling tools. */
  readonly tool_calls?: ToolCall[];
  /** Present on a `tool` message: id of the call it answers. */
  readonly tool_call_id?: string;
}

export type MistralErrorKind = 'auth' | 'quota' | 'network' | 'http' | 'parse';

/** Typed error surfacing a clear message to the UI (invalid key, quota, network…). */
export class MistralError extends Error {
  constructor(
    readonly kind: MistralErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MistralError';
  }
}

export interface MistralCompleteParams {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[];
}

/** Interface the agent loop depends on (re-implementable in tests). */
export interface MistralClient {
  /** One completion turn. Returns the `assistant` message (text and/or `tool_calls`). */
  complete(params: MistralCompleteParams): Promise<ChatMessage>;
}

export interface CreateMistralClientOptions {
  /** User API key (never logged). */
  readonly apiKey: string;
  /** Overrides the base URL (tests, or a future proxy). Default: the public Mistral API. */
  readonly baseUrl?: string;
  /** `fetch` injection (tests / environments without the global). */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.mistral.ai';

/** Builds a real (HTTP) Mistral client. */
export function createMistralClient(options: CreateMistralClientOptions): MistralClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new MistralError('network', 'fetch indisponible dans cet environnement.');
  }

  return {
    async complete({ model, messages, tools }) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
          }),
        });
      } catch {
        throw new MistralError('network', 'Échec réseau lors de l’appel à Mistral.', undefined);
      }

      if (!response.ok) {
        const detail = await safeErrorDetail(response);
        if (response.status === 401 || response.status === 403) {
          throw new MistralError(
            'auth',
            `Clé API refusée (${response.status}). ${detail}`.trim(),
            response.status,
          );
        }
        if (response.status === 429) {
          throw new MistralError('quota', `Quota Mistral atteint (429). ${detail}`.trim(), 429);
        }
        throw new MistralError(
          'http',
          `Erreur Mistral ${response.status}. ${detail}`.trim(),
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new MistralError('parse', 'Réponse Mistral illisible (JSON invalide).');
      }

      const message = extractMessage(payload);
      if (!message) throw new MistralError('parse', 'Réponse Mistral sans message exploitable.');
      return message;
    },
  };
}

/** Reads `choices[0].message` defensively (untrusted network input). */
function extractMessage(payload: unknown): ChatMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return null;
  const m = message as { content?: unknown; tool_calls?: unknown };
  const toolCalls = Array.isArray(m.tool_calls)
    ? (m.tool_calls.filter(isToolCall) as ToolCall[])
    : undefined;
  return {
    role: 'assistant',
    content: typeof m.content === 'string' ? m.content : null,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function isToolCall(value: unknown): value is ToolCall {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  return (
    typeof v.id === 'string' &&
    typeof v.function === 'object' &&
    v.function !== null &&
    typeof v.function.name === 'string' &&
    typeof v.function.arguments === 'string'
  );
}

/**
 * Readable error detail for the UI, extracted **only from the Mistral RESPONSE body** (truncated).
 * ⚠️ SECURITY: NEVER inject the request, its headers, or the API key here — only the server
 * response is read (it does not echo the `Authorization`). Keep this function limited to `response.text()`.
 */
async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}
