import { describe, expect, it } from 'vitest';
import { exportToDrawio, importFromDrawio } from './drawio.js';
import { parseScene, WhiteboardParseError, type Scene } from './scene.js';

function sampleScene(): Scene {
  return parseScene({
    version: 1,
    elements: [
      { kind: 'rectangle', id: 'rect1', x: 10, y: 20, width: 120, height: 60 },
      { kind: 'ellipse', id: 'ell1', x: 200, y: 40, width: 80, height: 80 },
      { kind: 'text', id: 'txt1', x: 5, y: 5, width: 100, height: 20, text: 'Hello & <world>' },
    ],
  });
}

describe('drawio — export', () => {
  it('produces an mxGraphModel with the root cells', () => {
    const xml = exportToDrawio(sampleScene());
    expect(xml).toContain('<mxGraphModel>');
    expect(xml).toContain('id="0"');
    expect(xml).toContain('id="1"');
    expect(xml).toContain('id="rect1"');
  });

  it('escapes the XML characters in the text', () => {
    const xml = exportToDrawio(sampleScene());
    expect(xml).toContain('Hello &amp; &lt;world&gt;');
    expect(xml).not.toContain('Hello & <world>');
  });
});

describe('drawio — import (untrusted input)', () => {
  it('imports vertices with their geometry', () => {
    const xml =
      '<mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="v1" value="A" style="rounded=0;" vertex="1" parent="1">' +
      '<mxGeometry x="10" y="20" width="100" height="40" as="geometry"/></mxCell>' +
      '<mxCell id="v2" style="ellipse;" vertex="1" parent="1">' +
      '<mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>';
    const scene = importFromDrawio(xml);
    expect(scene.elements).toHaveLength(2);
    expect(scene.elements[0]).toMatchObject({ kind: 'rectangle', id: 'v1', x: 10, y: 20 });
    expect(scene.elements[1]?.kind).toBe('ellipse');
  });

  it('ignores the root cells 0 and 1', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="v" vertex="1" parent="1"><mxGeometry x="0" y="0" width="1" height="1" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>';
    expect(importFromDrawio(xml).elements).toHaveLength(1);
  });

  it('rejects a non-string input with a typed error', () => {
    expect(() => importFromDrawio({ not: 'a string' })).toThrow(WhiteboardParseError);
  });

  it('rejects an XML that is not draw.io', () => {
    expect(() => importFromDrawio('<html><body>nope</body></html>')).toThrow(WhiteboardParseError);
  });

  it('rejects an mxGraphModel with no usable mxCell', () => {
    expect(() => importFromDrawio('<mxGraphModel><root></root></mxGraphModel>')).toThrow(
      WhiteboardParseError,
    );
  });

  it('resolves no external entity (no XXE surface)', () => {
    // An entity declaration must not be interpreted: only bounded regex parsing is done.
    const xml =
      '<!DOCTYPE x [<!ENTITY xxe "PWNED">]>' +
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="v" value="&xxe;" style="text;html=1;" vertex="1" parent="1">' +
      '<mxGeometry x="0" y="0" width="1" height="1" as="geometry"/></mxCell></root></mxGraphModel>';
    const scene = importFromDrawio(xml);
    // The value stays literal, never resolved.
    expect(scene.elements[0]).toMatchObject({ kind: 'text' });
    expect((scene.elements[0] as { text: string }).text).toBe('&xxe;');
  });
});

describe('drawio — round-trip with markers', () => {
  it('preserves the full draw.io style via a marker (export → import → export)', () => {
    const customStyle = 'rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;dashed=1;customProp=42;';
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      `<mxCell id="styled" value="x" style="${customStyle}" vertex="1" parent="1">` +
      '<mxGeometry x="3" y="4" width="20" height="10" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>';

    const scene = importFromDrawio(xml);
    const marker = scene.elements[0]?.markers.find((m) => m.format === 'drawio');
    expect(marker?.data['style']).toBe(customStyle);

    // Re-export: the irreducible style is re-injected as-is (lossless round-trip for it).
    const reexported = exportToDrawio(scene);
    expect(reexported).toContain('fillColor=#dae8fc');
    expect(reexported).toContain('customProp=42');
  });

  it('native → drawio → native round-trip keeps geometry and kinds', () => {
    const original = sampleScene();
    const back = importFromDrawio(exportToDrawio(original));
    expect(back.elements.map((e) => e.kind)).toEqual(['rectangle', 'ellipse', 'text']);
    expect(back.elements[0]).toMatchObject({ x: 10, y: 20, width: 120, height: 60 });
    expect((back.elements[2] as { text: string }).text).toBe('Hello & <world>');
  });
});

describe('drawio — edges (line vs arrow)', () => {
  function edgeScene(): Scene {
    return parseScene({
      version: 1,
      elements: [
        {
          kind: 'line',
          id: 'ln1',
          x: 30,
          y: 40,
          width: 50,
          height: 10,
          points: [
            [0, 0],
            [50, 10],
          ],
        },
        {
          kind: 'arrow',
          id: 'ar1',
          x: 100,
          y: 200,
          width: 20,
          height: 30,
          points: [
            [0, 0],
            [-20, 30],
          ],
        },
      ],
    });
  }

  it('native → drawio → native round-trip preserves kind, origin (x/y) and points for line AND arrow', () => {
    const original = edgeScene();
    const back = importFromDrawio(exportToDrawio(original));

    expect(back.elements.map((e) => e.kind)).toEqual(['line', 'arrow']);

    const line = back.elements.find((e) => e.kind === 'line');
    expect(line).toMatchObject({ id: 'ln1', x: 30, y: 40 });
    expect((line as { points: [number, number][] }).points).toEqual([
      [0, 0],
      [50, 10],
    ]);

    const arrow = back.elements.find((e) => e.kind === 'arrow');
    expect(arrow).toMatchObject({ id: 'ar1', x: 100, y: 200 });
    expect((arrow as { points: [number, number][] }).points).toEqual([
      [0, 0],
      [-20, 30],
    ]);
  });

  it('maps a headless edge (endArrow=none) to line', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="e" style="edgeStyle=none;html=1;endArrow=none;" edge="1" parent="1">' +
      '<mxGeometry relative="1" as="geometry"><Array as="points">' +
      '<mxPoint x="0" y="0"/><mxPoint x="40" y="0"/></Array></mxGeometry></mxCell>' +
      '</root></mxGraphModel>';
    expect(importFromDrawio(xml).elements[0]?.kind).toBe('line');
  });

  it('maps an edge with a head (endArrow=classic) to arrow', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="e" style="edgeStyle=none;html=1;endArrow=classic;" edge="1" parent="1">' +
      '<mxGeometry relative="1" as="geometry"><Array as="points">' +
      '<mxPoint x="0" y="0"/><mxPoint x="40" y="0"/></Array></mxGeometry></mxCell>' +
      '</root></mxGraphModel>';
    expect(importFromDrawio(xml).elements[0]?.kind).toBe('arrow');
  });

  it('maps an edge without an explicit style (draw.io default = arrow) to arrow', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="e" edge="1" parent="1">' +
      '<mxGeometry relative="1" as="geometry"><Array as="points">' +
      '<mxPoint x="0" y="0"/><mxPoint x="40" y="0"/></Array></mxGeometry></mxCell>' +
      '</root></mxGraphModel>';
    expect(importFromDrawio(xml).elements[0]?.kind).toBe('arrow');
  });
});
