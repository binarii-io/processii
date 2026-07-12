import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_MARKER,
  CLIPBOARD_VERSION,
  clipboardPayloadSchema,
  createMemoryClipboard,
  parseClipboardPayload,
  type ClipboardPayload,
} from './clipboard.js';

function payload(): ClipboardPayload {
  return {
    type: CLIPBOARD_MARKER,
    version: CLIPBOARD_VERSION,
    elements: [{ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 10, height: 10 }] as never,
  };
}

describe('clipboard — payload schema', () => {
  it('parses a well-formed payload (applying element defaults)', () => {
    const parsed = clipboardPayloadSchema.parse(payload());
    expect(parsed.type).toBe(CLIPBOARD_MARKER);
    expect(parsed.version).toBe(CLIPBOARD_VERSION);
    expect(parsed.elements).toHaveLength(1);
    // Element defaults are applied at the boundary (z/angle/markers/style).
    expect(parsed.elements[0]).toMatchObject({ id: 'a', z: 0, markers: [] });
  });

  it('parseClipboardPayload returns null for foreign / malformed input (never throws)', () => {
    expect(parseClipboardPayload('just some text')).toBeNull();
    expect(parseClipboardPayload({ type: 'other', version: 1, elements: [] })).toBeNull();
    expect(parseClipboardPayload(null)).toBeNull();
    expect(parseClipboardPayload(42)).toBeNull();
  });

  it('rejects a payload with no element (an empty copy yields null, never a payload)', () => {
    expect(parseClipboardPayload({ ...payload(), elements: [] })).toBeNull();
  });

  it('rejects a mismatched version (breaking payload shape)', () => {
    expect(parseClipboardPayload({ ...payload(), version: 999 })).toBeNull();
  });
});

describe('clipboard — in-memory store', () => {
  it('reads back the last written payload', () => {
    const clip = createMemoryClipboard();
    expect(clip.read()).toBeNull();
    const p = payload();
    clip.write(p);
    expect(clip.read()).toBe(p);
  });

  it('overwrites on a second write', () => {
    const clip = createMemoryClipboard();
    clip.write(payload());
    const second = { ...payload(), elements: [{ ...payload().elements[0], id: 'b' }] as never };
    clip.write(second);
    expect(clip.read()).toBe(second);
  });
});
