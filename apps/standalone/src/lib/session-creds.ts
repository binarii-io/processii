/**
 * **Per-document session credentials**, persisted in `localStorage`. A document that was
 * **hosted** or **joined** becomes a **durable** shared session: its credentials (room +
 * secret) are remembered, enabling **automatic reconnection** when reopening it — on the host
 * side as on the guest side (the role does not matter at reconnection: y-webrtc is symmetric,
 * both peers join the same room and Yjs merges).
 *
 * The _secret_ is a session encryption key, **public for the participants** but sensitive:
 * it lives only locally (never sent to the signaling, see `SECURITY.md`).
 */
export interface SessionCreds {
  readonly room: string;
  readonly secret: string;
}

const PREFIX = 'memorii.whiteboard.session.';

function keyFor(docId: string): string {
  return `${PREFIX}${docId}`;
}

/** A document's session credentials, or `null` when it is not (or no longer) shared. */
export function loadCreds(docId: string): SessionCreds | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { room?: unknown }).room === 'string' &&
      typeof (parsed as { secret?: unknown }).secret === 'string'
    ) {
      const { room, secret } = parsed as SessionCreds;
      if (room.length > 0 && secret.length > 0) return { room, secret };
    }
    return null;
  } catch {
    return null;
  }
}

/** Remembers (or updates) a document's session credentials. */
export function saveCreds(docId: string, creds: SessionCreds): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(keyFor(docId), JSON.stringify(creds));
  } catch {
    /* quota / private mode: ignored */
  }
}

/** Forgets a document's credentials (it becomes purely local again). */
export function clearCreds(docId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(keyFor(docId));
  } catch {
    /* ignore */
  }
}

/** Ids of the documents that are shared sessions (have remembered credentials). */
export function listSessionDocIds(): Set<string> {
  const ids = new Set<string>();
  if (typeof localStorage === 'undefined') return ids;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) ids.add(key.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return ids;
}
