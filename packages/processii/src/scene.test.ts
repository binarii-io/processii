import { describe, expect, it } from 'vitest';
import {
  emptyScene,
  isPanelElementKind,
  LEGACY_CLUSTER_ID,
  parseElement,
  parseScene,
  safeLinkHref,
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
      boardType: 'ideation',
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

  it('applies the process collection + boardType defaults on a minimal (legacy) scene', () => {
    // A legacy scene omitting `boardType` must default to `ideation` (backward-compat contract).
    expect(parseScene({ version: 1, elements: [] })).toMatchObject({
      swimlanes: [],
      agentGroups: [],
      swimlanesWidth: 2000,
      boardType: 'ideation',
    });
  });

  it('rejects a scene containing an invalid element', () => {
    expect(() => parseScene({ version: 1, elements: [{ kind: 'rectangle' }] })).toThrow(
      WhiteboardParseError,
    );
  });

  it('keeps an element hyperlink (`url`) and rejects an empty one', () => {
    const el = parseElement({
      kind: 'rectangle',
      id: 'r',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      url: 'https://decathlon.fr',
    });
    expect(el.url).toBe('https://decathlon.fr');
    // Absent by default (no link).
    expect(parseElement({ kind: 'rectangle', id: 'r2', x: 0, y: 0, width: 1, height: 1 }).url).toBe(
      undefined,
    );
    // An empty string is not a valid link (min length 1).
    expect(() =>
      parseElement({ kind: 'text', id: 't', x: 0, y: 0, width: 1, height: 1, text: 'x', url: '' }),
    ).toThrow(WhiteboardParseError);
  });
});

describe('safeLinkHref (#266) — scheme guard', () => {
  it('prefixes a bare host with https://', () => {
    expect(safeLinkHref('example.com')).toBe('https://example.com');
    expect(safeLinkHref('  example.com/path  ')).toBe('https://example.com/path');
  });
  it('keeps http/https/mailto as-is', () => {
    expect(safeLinkHref('http://x.test')).toBe('http://x.test');
    expect(safeLinkHref('https://x.test')).toBe('https://x.test');
    expect(safeLinkHref('mailto:a@b.test')).toBe('mailto:a@b.test');
  });
  it('passes a host-relative deep link through', () => {
    expect(safeLinkHref('/docs/42')).toBe('/docs/42');
  });
  it('refuses a dangerous scheme, a protocol-relative url and empty input', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
    expect(safeLinkHref('data:text/html,x')).toBeNull();
    expect(safeLinkHref('//evil.example')).toBeNull(); // protocol-relative → open-redirect vector
    expect(safeLinkHref('   ')).toBeNull();
  });
});

describe('isPanelElementKind (#266)', () => {
  it('is true for box-like kinds, false for connectors', () => {
    expect(isPanelElementKind('step')).toBe(true);
    expect(isPanelElementKind('rectangle')).toBe(true);
    expect(isPanelElementKind('ellipse')).toBe(true);
    expect(isPanelElementKind('text')).toBe(true);
    expect(isPanelElementKind('line')).toBe(false);
    expect(isPanelElementKind('arrow')).toBe(false);
  });
});
