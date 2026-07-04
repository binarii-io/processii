import { describe, expect, it } from 'vitest';
import {
  emptyScene,
  LEGACY_CLUSTER_ID,
  parseElement,
  parseScene,
  WhiteboardParseError,
} from './scene.js';

describe('scene model — validation', () => {
  it('applies the defaults on a minimal element', () => {
    const el = parseElement({ kind: 'rectangle', id: 'r1', x: 0, y: 0, width: 10, height: 5 });
    expect(el.stroke).toBe('text');
    expect(el.fill).toBe('transparent');
    expect(el.strokeWidth).toBe(1);
    expect(el.opacity).toBe(1);
    expect(el.angle).toBe(0);
    expect(el.z).toBe(0);
    expect(el.markers).toEqual([]);
  });

  it('step: "item" defaults (white surface background, no outline) + no emotion', () => {
    const el = parseElement({ kind: 'step', id: 's1', x: 0, y: 0, width: 200, height: 120 });
    expect(el.kind).toBe('step');
    if (el.kind !== 'step') return;
    expect(el.fill).toBe('surface'); // baseStyle override (transparent) → white card
    expect(el.stroke).toBe('transparent'); // no outline by default
    expect(el.emotion).toBeUndefined(); // no emotion until set
  });

  it('validates a line with at least 2 points', () => {
    const el = parseElement({
      kind: 'line',
      id: 'l1',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [10, 10],
      ],
    });
    expect(el.kind).toBe('line');
  });

  it('rejects an unknown kind with a typed error', () => {
    expect(() =>
      parseElement({ kind: 'hexagon', id: 'x', x: 0, y: 0, width: 1, height: 1 }),
    ).toThrow(WhiteboardParseError);
  });

  it('rejects a line with a single point', () => {
    expect(() =>
      parseElement({ kind: 'line', id: 'l', x: 0, y: 0, width: 0, height: 0, points: [[0, 0]] }),
    ).toThrow(WhiteboardParseError);
  });

  it('rejects non-finite coordinates', () => {
    expect(() =>
      parseElement({ kind: 'rectangle', id: 'r', x: Infinity, y: 0, width: 1, height: 1 }),
    ).toThrow(WhiteboardParseError);
  });

  it('exposes the zod issues in the error', () => {
    try {
      parseElement({ kind: 'rectangle' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(WhiteboardParseError);
      expect((err as WhiteboardParseError).issues?.length).toBeGreaterThan(0);
    }
  });

  it('validates an empty scene', () => {
    expect(parseScene(emptyScene())).toEqual({
      version: 2,
      elements: [],
      swimlanes: [],
      swimlaneClusters: [],
      swimlanesWidth: 2000,
      agentGroups: [],
    });
  });

  it('migrates a v1 scene: lanes default to the legacy cluster, clusters default empty', () => {
    const parsed = parseScene({
      version: 1,
      elements: [],
      swimlanes: [{ id: 'l1', order: 0, height: 120 }],
      swimlanesWidth: 1500,
    });
    expect(parsed.swimlanes[0]).toMatchObject({ id: 'l1', clusterId: LEGACY_CLUSTER_ID });
    expect(parsed.swimlaneClusters).toEqual([]);
  });

  it('applies the process collection defaults on a minimal scene', () => {
    expect(parseScene({ version: 1, elements: [] })).toMatchObject({
      swimlanes: [],
      agentGroups: [],
      swimlanesWidth: 2000,
    });
  });

  it('rejects a scene containing an invalid element', () => {
    expect(() => parseScene({ version: 1, elements: [{ kind: 'rectangle' }] })).toThrow(
      WhiteboardParseError,
    );
  });
});
