import { describe, expect, it } from 'vitest';
import {
  BundleParseError,
  bundleToNewSpace,
  mergeBundleIntoSpace,
  parseBundle,
  toBundle,
  toBundleString,
  type BundleDocument,
  type IdFactory,
} from './bundle.js';

function doc(id: string, name: string, elementIds: string[]): BundleDocument {
  return {
    id,
    name,
    scene: {
      version: 1,
      elements: elementIds.map((eid) => ({
        kind: 'rectangle' as const,
        id: eid,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        angle: 0,
        stroke: 'text',
        fill: 'text',
        strokeWidth: 1,
        opacity: 1,
        z: 0,
        markers: [],
      })),
      swimlanes: [],
      swimlanesWidth: 2000,
      agentGroups: [],
    },
  };
}

/** Deterministic ID generator for reproducible tests. */
function seqIds(prefix: string): IdFactory {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

describe('bundle — export', () => {
  it('export → parse round-trip keeps the documents and scenes', () => {
    const docs = [doc('a', 'Alpha', ['e1', 'e2']), doc('b', 'Beta', ['e3'])];
    const parsed = parseBundle(toBundleString(docs));
    expect(parsed.version).toBe(1);
    expect(parsed.documents.map((d) => d.id)).toEqual(['a', 'b']);
    expect(parsed.documents[0]?.scene.elements).toHaveLength(2);
    expect(parsed.documents[1]?.scene.elements[0]?.id).toBe('e3');
  });

  it('toBundle produces the current version', () => {
    expect(toBundle([]).version).toBe(1);
  });
});

describe('bundle — parse (untrusted input)', () => {
  it('accepts an already-parsed object', () => {
    const bundle = toBundle([doc('a', 'Alpha', ['e1'])]);
    expect(parseBundle(bundle).documents).toHaveLength(1);
  });

  it('rejects syntactically invalid JSON', () => {
    expect(() => parseBundle('{ not json')).toThrow(BundleParseError);
  });

  it('rejects an invalid structure (wrong version)', () => {
    expect(() => parseBundle({ version: 99, documents: [] })).toThrow(BundleParseError);
  });

  it('rejects an invalid scene (negative geometry)', () => {
    const bad = {
      version: 1,
      documents: [
        {
          id: 'a',
          name: 'A',
          scene: {
            version: 1,
            elements: [{ kind: 'rectangle', id: 'x', x: 0, y: 0, width: -1, height: 10 }],
          },
        },
      ],
    };
    expect(() => parseBundle(bad)).toThrow(BundleParseError);
  });

  it('rejects duplicated document IDs inside the file', () => {
    const bad = { version: 1, documents: [doc('a', 'A', ['e1']), doc('a', 'B', ['e2'])] };
    expect(() => parseBundle(bad)).toThrow(/dupliqué/);
  });
});

describe('bundle — import nouvel espace', () => {
  it('takes the documents as-is', () => {
    const bundle = toBundle([doc('a', 'Alpha', ['e1'])]);
    const space = bundleToNewSpace(bundle);
    expect(space).toHaveLength(1);
    expect(space[0]?.id).toBe('a');
    expect(space[0]?.scene.elements[0]?.id).toBe('e1');
  });
});

describe('bundle — merge with ID remapping', () => {
  it('assigns new IDs to the imported documents AND elements', () => {
    const existing = [doc('a', 'Alpha', ['e1'])];
    const bundle = toBundle([doc('a', 'Imported', ['e1', 'e2'])]); // same IDs → collision without remap
    const merged = mergeBundleIntoSpace(existing, bundle, seqIds('new'));

    expect(merged).toHaveLength(2);
    // The existing content is intact.
    expect(merged[0]).toEqual(existing[0]);
    // The import has a new document id distinct from the existing one.
    expect(merged[1]?.id).toBe('new-1');
    expect(merged[1]?.id).not.toBe('a');
    // The imported elements are remapped.
    expect(merged[1]?.scene.elements.map((e) => e.id)).toEqual(['new-2', 'new-3']);
  });

  it('no ID collision in the merged space (re-import of the same bundle)', () => {
    const bundle = toBundle([doc('a', 'X', ['e1', 'e2'])]);
    let space = mergeBundleIntoSpace([], bundle, seqIds('first'));
    space = mergeBundleIntoSpace(space, bundle, seqIds('second'));

    const allDocIds = space.map((d) => d.id);
    expect(new Set(allDocIds).size).toBe(allDocIds.length);

    const allElementIds = space.flatMap((d) => d.scene.elements.map((e) => e.id));
    expect(new Set(allElementIds).size).toBe(allElementIds.length);
  });

  it('preserves the element names and geometry during the remap', () => {
    const bundle = toBundle([doc('a', 'Garde-nom', ['e1'])]);
    const merged = mergeBundleIntoSpace([], bundle, seqIds('n'));
    expect(merged[0]?.name).toBe('Garde-nom');
    expect(merged[0]?.scene.elements[0]?.width).toBe(10);
  });
});

describe('bundle — sub-process & hierarchy', () => {
  // Parent 'p' with a step linked to the sub-process 'c'; child 'c' (parentId 'p').
  const sceneWithStep = (subprocessRef: string) => ({
    version: 1 as const,
    elements: [
      {
        kind: 'step' as const,
        id: 's1',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        angle: 0,
        stroke: 'text',
        fill: 'transparent',
        strokeWidth: 1,
        opacity: 1,
        z: 0,
        markers: [],
        name: 'Étape',
        description: '',
        skills: [],
        deliverables: [],
        subprocessRef,
      },
    ],
    swimlanes: [],
    swimlanesWidth: 2000,
    agentGroups: [],
  });
  const emptyScene = () => ({
    version: 1 as const,
    elements: [],
    swimlanes: [],
    swimlanesWidth: 2000,
    agentGroups: [],
  });

  it('parse keeps parentId and subprocessRef', () => {
    const parsed = parseBundle({
      version: 1,
      documents: [
        { id: 'p', name: 'Parent', scene: sceneWithStep('c') },
        { id: 'c', name: 'Enfant', parentId: 'p', scene: emptyScene() },
      ],
    });
    expect(parsed.documents[1]?.parentId).toBe('p');
    const step = parsed.documents[0]?.scene.elements[0];
    expect(step && 'subprocessRef' in step ? step.subprocessRef : undefined).toBe('c');
  });

  it('merge remaps parentId (doc→doc) AND subprocessRef (step→doc)', () => {
    const bundle = parseBundle({
      version: 1,
      documents: [
        { id: 'p', name: 'Parent', scene: sceneWithStep('c') },
        { id: 'c', name: 'Enfant', parentId: 'p', scene: emptyScene() },
      ],
    });
    const merged = mergeBundleIntoSpace([], bundle, seqIds('n'));
    const parent = merged[0]!;
    const child = merged[1]!;
    // The links point to the **new** document ids, not the old 'p'/'c'.
    expect(child.parentId).toBe(parent.id);
    const step = parent.scene.elements[0];
    expect(step && 'subprocessRef' in step ? step.subprocessRef : undefined).toBe(child.id);
    expect(parent.id).not.toBe('p');
  });

  it('new-space import keeps the links (ids unchanged)', () => {
    const bundle = parseBundle({
      version: 1,
      documents: [
        { id: 'p', name: 'Parent', scene: sceneWithStep('c') },
        { id: 'c', name: 'Enfant', parentId: 'p', scene: emptyScene() },
      ],
    });
    const space = bundleToNewSpace(bundle);
    expect(space[1]?.parentId).toBe('p');
  });
});
