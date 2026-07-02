import { describe, expect, it } from 'vitest';
import { readEnv } from './env.js';

describe('readEnv (front-end config, no secret)', () => {
  it('applies public default values', () => {
    const env = readEnv({});
    expect(env.signalingUrls.length).toBeGreaterThan(0);
    expect(env.signalingUrls.every((u) => u.startsWith('ws'))).toBe(true);
    expect(env.stunUrls.every((u) => u.startsWith('stun'))).toBe(true);
    expect(env.demo).toBe(false);
  });

  it('parses a comma-separated signaling list', () => {
    const env = readEnv({ VITE_SIGNALING_URLS: 'wss://a.example, wss://b.example ' });
    expect(env.signalingUrls).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('enables demo mode via VITE_E2E=1', () => {
    expect(readEnv({ VITE_E2E: '1' }).demo).toBe(true);
    expect(readEnv({ VITE_E2E: '0' }).demo).toBe(false);
  });

  it('rejects a non-ws(s) signaling URL', () => {
    expect(() => readEnv({ VITE_SIGNALING_URLS: 'http://nope.example' })).toThrow();
  });

  it('rejects an invalid STUN URL', () => {
    expect(() => readEnv({ VITE_STUN_URLS: 'https://nope.example' })).toThrow();
  });
});
