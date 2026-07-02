import { describe, expect, it } from 'vitest';
import { SignalingValidationError } from './lib/signaling.js';
import { createWiring } from './bootstrap.js';

const env = {
  signalingUrls: ['wss://signaling.example'],
  stunUrls: ['stun:stun.example:19302'],
  iceUrl: 'https://signaling.example/ice',
  demo: false,
} as const;

describe('createWiring', () => {
  it('always provides a local persistence (offline-first)', () => {
    const wiring = createWiring(env);
    expect(typeof wiring.persistenceFactoryFor('doc-1')).toBe('function');
  });

  it('provides a P2P transport when room/secret are valid', () => {
    const wiring = createWiring(env);
    expect(wiring.transportFactoryFor('room-1', 'secret')).toBeTypeOf('function');
  });

  it('refuses an invalid room at the boundary (SECURITY.md)', () => {
    const wiring = createWiring(env);
    expect(() => wiring.transportFactoryFor('bad/room', 'secret')).toThrow(
      SignalingValidationError,
    );
  });

  it('refuses an empty secret at the boundary', () => {
    const wiring = createWiring(env);
    expect(() => wiring.transportFactoryFor('room-1', '')).toThrow(SignalingValidationError);
  });

  it('in demo mode, no P2P transport (no network)', () => {
    const wiring = createWiring({ ...env, demo: true });
    expect(wiring.transportFactoryFor('room-1', 'secret')).toBeUndefined();
  });
});
