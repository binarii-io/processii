/**
 * Opaque id generation for created domain objects (elements, swimlanes, groups…).
 *
 * Shared by the agent-ops catalogue (`agent-ops.ts`) and the engine (`engine.ts`, e.g. `paste`),
 * so a single convention produces every fresh id. **DOM-free / React-free**: usable from a pure
 * Node backend as well as the browser.
 */

let idSeq = 0;

/**
 * Fresh opaque id for a created object (`<prefix>:<id>`). Uses `crypto.randomUUID` when available
 * (Node ≥ 19, browsers) with a timestamp+counter fallback for older runtimes. Ids are host-opaque;
 * a caller/test can also pass an explicit `id` where deterministic output is needed.
 */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
  return `${prefix}:${rand}`;
}
