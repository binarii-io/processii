import { describe, expect, it } from 'vitest';
import {
  exportToExcalidraw,
  exportToExcalidrawString,
  importFromExcalidraw,
} from './excalidraw.js';
import { parseScene, WhiteboardParseError, type Scene } from './scene.js';

function sampleScene(): Scene {
  return parseScene({
    version: 1,
    elements: [
      { kind: 'rectangle', id: 'r1', x: 10, y: 20, width: 100, height: 50, stroke: '#ff0000' },
      {
        kind: 'arrow',
        id: 'ar1',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [
          [0, 0],
          [40, 40],
        ],
      },
      { kind: 'text', id: 't1', x: 5, y: 5, width: 0, height: 0, text: 'hi', fontSize: 18 },
    ],
  });
}

describe('excalidraw — export', () => {
  it('produces a well-typed excalidraw document', () => {
    const doc = exportToExcalidraw(sampleScene());
    expect(doc.type).toBe('excalidraw');
    expect(doc.elements).toHaveLength(3);
  });

  it('exportToExcalidrawString returns parseable JSON', () => {
    const str = exportToExcalidrawString(sampleScene());
    expect(() => JSON.parse(str)).not.toThrow();
  });

  it('converts opacity 0..1 → 0..100', () => {
    const scene = parseScene({
      version: 1,
      elements: [{ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 1, height: 1, opacity: 0.5 }],
    });
    const doc = exportToExcalidraw(scene);
    expect((doc.elements[0] as { opacity: number }).opacity).toBe(50);
  });
});

describe('excalidraw — import (untrusted input)', () => {
  it('imports a valid document', () => {
    const scene = importFromExcalidraw({
      type: 'excalidraw',
      elements: [{ id: 'a', type: 'rectangle', x: 1, y: 2, width: 3, height: 4 }],
    });
    expect(scene.elements[0]).toMatchObject({ kind: 'rectangle', id: 'a', x: 1, y: 2 });
  });

  it('imports from a JSON string', () => {
    const scene = importFromExcalidraw(
      JSON.stringify({
        type: 'excalidraw',
        elements: [{ id: 'a', type: 'ellipse', width: 5, height: 5 }],
      }),
    );
    expect(scene.elements[0]?.kind).toBe('ellipse');
  });

  it('rejects malformed JSON with a typed error', () => {
    expect(() => importFromExcalidraw('{not json')).toThrow(WhiteboardParseError);
  });

  it('rejects a structure without the excalidraw type', () => {
    expect(() => importFromExcalidraw({ elements: [] })).toThrow(WhiteboardParseError);
  });

  it('rejects when elements is not an array', () => {
    expect(() => importFromExcalidraw({ type: 'excalidraw', elements: 'nope' })).toThrow(
      WhiteboardParseError,
    );
  });

  it('preserves an unknown type as a marked rectangle (nothing disappears)', () => {
    const scene = importFromExcalidraw({
      type: 'excalidraw',
      elements: [{ id: 'frame1', type: 'frame', x: 0, y: 0, width: 10, height: 10 }],
    });
    expect(scene.elements[0]?.kind).toBe('rectangle');
    expect(scene.elements[0]?.markers[0]).toMatchObject({
      format: 'excalidraw',
      data: { type: 'frame' },
    });
  });
});

describe('excalidraw — round-trip with markers', () => {
  it('preserves the irreducible fields via a marker (export → import → export)', () => {
    // Non-native Excalidraw field: roundness. Must survive via the marker.
    const imported = importFromExcalidraw({
      type: 'excalidraw',
      elements: [
        {
          id: 'r',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          roundness: { type: 3 },
          customData: { foo: 'bar' },
        },
      ],
    });
    const marker = imported.elements[0]?.markers.find((m) => m.format === 'excalidraw');
    expect(marker?.data).toMatchObject({ roundness: { type: 3 }, customData: { foo: 'bar' } });

    // Re-export: the irreducible field is re-injected.
    const reexported = exportToExcalidraw(imported);
    expect(reexported.elements[0]).toMatchObject({
      roundness: { type: 3 },
      customData: { foo: 'bar' },
    });
  });

  it('native → excalidraw → native round-trip keeps the geometry', () => {
    const original = sampleScene();
    const back = importFromExcalidraw(exportToExcalidraw(original));
    // Geometry and kinds preserved.
    expect(back.elements.map((e) => e.kind)).toEqual(['rectangle', 'arrow', 'text']);
    expect(back.elements[0]).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
    expect(back.elements[2]).toMatchObject({ kind: 'text', text: 'hi' });
  });
});
