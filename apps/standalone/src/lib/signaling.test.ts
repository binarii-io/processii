import { describe, expect, it } from 'vitest';
import {
  SIGNALING_LIMITS,
  SignalingValidationError,
  generateRoomName,
  generateRoomSecret,
  sanitizePeerName,
  validateRoomName,
  validateRoomSecret,
} from './signaling.js';

describe('validateRoomName', () => {
  it('accepts an alphanumeric name with - and _', () => {
    expect(validateRoomName('room_42-abc')).toBe('room_42-abc');
  });

  it('refuses an empty name', () => {
    expect(() => validateRoomName('')).toThrow(SignalingValidationError);
  });

  it('refuses characters outside the alphabet (anti-abuse)', () => {
    expect(() => validateRoomName('a/b')).toThrow(SignalingValidationError);
    expect(() => validateRoomName('a b')).toThrow(SignalingValidationError);
    expect(() => validateRoomName('héllo')).toThrow(SignalingValidationError);
  });

  it('refuses an over-long name (bound)', () => {
    const tooLong = 'a'.repeat(SIGNALING_LIMITS.roomNameMaxLength + 1);
    expect(() => validateRoomName(tooLong)).toThrow(SignalingValidationError);
  });

  it('refuses a non-string value', () => {
    expect(() => validateRoomName(42)).toThrow(SignalingValidationError);
  });
});

describe('validateRoomSecret', () => {
  it('accepts a non-empty bounded secret', () => {
    expect(validateRoomSecret('s3cr3t')).toBe('s3cr3t');
  });
  it('refuses an empty secret', () => {
    expect(() => validateRoomSecret('')).toThrow(SignalingValidationError);
  });
  it('refuses an over-long secret', () => {
    expect(() => validateRoomSecret('x'.repeat(SIGNALING_LIMITS.secretMaxLength + 1))).toThrow(
      SignalingValidationError,
    );
  });
});

describe('sanitizePeerName (untrusted remote label)', () => {
  it('strips the control characters (C0/C1) but keeps the inner spaces', () => {
    expect(sanitizePeerName('Al\u0007ice')).toBe('Alice');
    expect(sanitizePeerName('Al ice')).toBe('Al ice');
    expect(sanitizePeerName('  Bob  ')).toBe('Bob');
  });
  it('truncates at the bound', () => {
    const long = 'n'.repeat(SIGNALING_LIMITS.peerNameMaxLength + 10);
    expect(sanitizePeerName(long)).toHaveLength(SIGNALING_LIMITS.peerNameMaxLength);
  });
  it('falls back when empty or non-string', () => {
    expect(sanitizePeerName('   ')).toBe('Invité');
    expect(sanitizePeerName(undefined)).toBe('Invité');
    expect(sanitizePeerName(42, 'Anon')).toBe('Anon');
  });
});

describe('generators', () => {
  it('generateRoomName produces a valid name', () => {
    expect(() => validateRoomName(generateRoomName())).not.toThrow();
  });
  it('generateRoomSecret produces a valid, distinct secret', () => {
    const a = generateRoomSecret();
    const b = generateRoomSecret();
    expect(() => validateRoomSecret(a)).not.toThrow();
    expect(a).not.toBe(b);
  });
});
