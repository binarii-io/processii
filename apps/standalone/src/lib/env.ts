import { z } from 'zod';

/**
 * **12-factor** front-end configuration (`AGENTS.md`, `SECURITY.md`) — public standalone site.
 *
 * No secret value: the `VITE_*` variables are injected **at build time** by Vite and exposed to
 * the bundle (hence PUBLIC). For a P2P site, the signaling URLs and STUN servers are public by
 * nature — NEVER put a secret there. Validation at the boundary with zod: an invalid config
 * breaks the startup explicitly rather than producing silent bugs.
 *
 * - `VITE_SIGNALING_URLS`: **comma-separated** list of y-webrtc signaling WebSocket URLs
 *   (peer rendezvous; they only see connection metadata, never the board content).
 * - `VITE_STUN_URLS`: list of `stun:` URLs for NAT traversal. **No TURN in V1**: when the ICE
 *   negotiation fails (symmetric NAT), the connection stays **cleanly** `disconnected`
 *   (crdt-core's `ConnectionStatus` contract only has `disconnected | connecting | connected`).
 * - `VITE_E2E`: demo mode (no real network; transport injected/disabled), set at build time by
 *   Playwright. Only `VITE_`-prefixed variables are exposed to the bundle by Vite.
 */
const rawSchema = z.object({
  VITE_SIGNALING_URLS: z.string().optional(),
  VITE_STUN_URLS: z.string().optional(),
  VITE_ICE_URL: z.string().optional(),
  VITE_E2E: z.string().optional(),
});

/**
 * Default signaling: **our** Cloudflare Worker (`infra/signaling-cf`), domain managed with
 * Terraform in `binarii-infra`. Overridable via `VITE_SIGNALING_URLS` at build time. (The old
 * public default `wss://signaling.yjs.dev` is no longer reliable.)
 */
const DEFAULT_SIGNALING_URLS = ['wss://signaling.binarii.app'] as const;
/** Default public STUN (Google) — override via build env. */
const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'] as const;
/**
 * HTTP endpoint returning `{ iceServers }` (STUN **+ TURN** when configured on the Worker side).
 * Used to **reliabilize NAT traversal** across different networks (TURN relays when direct P2P
 * fails; the content stays end-to-end encrypted by the room secret). Our `infra/signaling-cf`
 * Worker exposes it at `/ice` (ephemeral TURN creds). Empty ⇒ STUN only.
 */
const DEFAULT_ICE_URL = 'https://signaling.binarii.app/ice';

function isOn(value: string | undefined): boolean {
  return value === '1';
}

/** Splits `a, b ,c` → `['a','b','c']` ignoring empty entries. */
function splitList(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value) return [...fallback];
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [...fallback];
}

const wsUrl = z
  .string()
  .url()
  .refine(
    (u) => u.startsWith('ws://') || u.startsWith('wss://'),
    'URL de signaling : doit être ws(s)://',
  );
const stunUrl = z
  .string()
  .refine((u) => u.startsWith('stun:') || u.startsWith('stuns:'), 'URL STUN : doit être stun(s):');

export interface StandaloneEnv {
  readonly signalingUrls: readonly string[];
  readonly stunUrls: readonly string[];
  /** `{ iceServers }` endpoint (STUN + TURN). Empty string ⇒ STUN only (no TURN). */
  readonly iceUrl: string;
  /** Demo mode: no real network (E2E / offline preview). */
  readonly demo: boolean;
}

/** Reads + validates the config from a variable bag (default: `import.meta.env`). */
export function readEnv(raw: Record<string, string | undefined> = import.meta.env): StandaloneEnv {
  const parsed = rawSchema.parse(raw);
  const signalingUrls = z
    .array(wsUrl)
    .parse(splitList(parsed.VITE_SIGNALING_URLS, DEFAULT_SIGNALING_URLS));
  const stunUrls = z.array(stunUrl).parse(splitList(parsed.VITE_STUN_URLS, DEFAULT_STUN_URLS));
  const iceUrl = parsed.VITE_ICE_URL !== undefined ? parsed.VITE_ICE_URL : DEFAULT_ICE_URL;
  return {
    signalingUrls,
    stunUrls,
    iceUrl,
    demo: isOn(parsed.VITE_E2E),
  };
}
