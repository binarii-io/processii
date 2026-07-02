/**
 * **P2P signaling trust boundary** (`SECURITY.md` §2: "Validate/limit the signaling messages").
 *
 * The y-webrtc signaling makes peers meet in a **room** (string shared out-of-band, via the
 * invite link). Everything coming from a remote peer is **untrusted**. The values the app
 * controls or receives are framed here:
 *
 *  - the **room name** (typed/pasted by the user, or taken from a link) must be bounded and on
 *    a safe alphabet — an arbitrarily long or exotic name is an abuse vector for the signaling
 *    server and breaks session isolation;
 *  - the room's **encryption secret** (y-webrtc symmetric key, encrypting the traffic
 *    end-to-end over the signaling) must be present and bounded — without it the content would
 *    transit in clear through the public signaling server;
 *  - the **presence identities** (displayed peer labels) received via awareness are bounded and
 *    cleaned before display (anti-injection / anti-UI-spam).
 */
import { z } from 'zod';

/** Bounds (max size) of the signaling values. Chosen broad but finite. */
export const SIGNALING_LIMITS = {
  roomNameMaxLength: 128,
  secretMaxLength: 256,
  peerNameMaxLength: 64,
} as const;

/** Room: alphanumeric + `-` `_`, bounded. Refuses the arbitrary (length, control characters). */
export const roomNameSchema = z
  .string()
  .min(1)
  .max(SIGNALING_LIMITS.roomNameMaxLength)
  .regex(/^[A-Za-z0-9_-]+$/, 'Nom de room : caractères [A-Za-z0-9_-] uniquement.');

/** Room secret (shared key): non-empty, bounded. */
export const roomSecretSchema = z.string().min(1).max(SIGNALING_LIMITS.secretMaxLength);

/** Typed error for a signaling value refused at the boundary. */
export class SignalingValidationError extends Error {
  override readonly name = 'SignalingValidationError';
}

/** Validates a room name (user input / link). Throws `SignalingValidationError` when invalid. */
export function validateRoomName(input: unknown): string {
  const result = roomNameSchema.safeParse(input);
  if (!result.success) {
    throw new SignalingValidationError('Nom de room invalide.');
  }
  return result.data;
}

/** Validates a room secret. Throws `SignalingValidationError` when invalid. */
export function validateRoomSecret(input: unknown): string {
  const result = roomSecretSchema.safeParse(input);
  if (!result.success) {
    throw new SignalingValidationError('Secret de room invalide.');
  }
  return result.data;
}

/** C0/C1 control characters (non-printable) — stripped from untrusted labels. */
// eslint-disable-next-line no-control-regex -- control characters are explicitly targeted.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Cleans + bounds a presence label received from a remote peer (untrusted). Control characters
 * are stripped, the label is trimmed, truncated, and falls back to a neutral label when empty.
 */
export function sanitizePeerName(input: unknown, fallback = 'Invité'): string {
  if (typeof input !== 'string') return fallback;
  const cleaned = input.replace(CONTROL_CHARS, '').trim();
  if (cleaned.length === 0) return fallback;
  return cleaned.slice(0, SIGNALING_LIMITS.peerNameMaxLength);
}

/**
 * Generates a random room secret (URL-safe hex). Used when the host opens a session without a
 * provided secret — each session has its own signaling encryption key.
 */
export function generateRoomSecret(): string {
  return randomHex(24);
}

/** Generates a random room name conforming to the schema. */
export function generateRoomName(): string {
  return randomHex(8);
}

function randomHex(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
