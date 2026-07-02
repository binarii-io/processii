import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpace } from './use-space.js';

/** Local document reordering (the array = the sidebar display order). */
describe('useSpace — reorderDocuments', () => {
  const participant = { id: 'p1', name: 'Moi', color: 'accent' };

  it('reorders siblings in place and leaves the others untouched', () => {
    const { result } = renderHook(() => useSpace({ participant }));
    let a = '';
    let b = '';
    let c = '';
    act(() => {
      a = result.current.createDocument('A');
    });
    act(() => {
      b = result.current.createDocument('B');
    });
    act(() => {
      c = result.current.createDocument('C');
    });
    expect(result.current.documents.map((d) => d.id)).toEqual([a, b, c]);

    // Reorders A and C (root siblings) → C before A; B keeps its relative slot.
    act(() => {
      result.current.reorderDocuments([c, a]);
    });
    // At the slots occupied by {a, c} (index 0 and 2), [c, a] is placed → [c, b, a].
    expect(result.current.documents.map((d) => d.id)).toEqual([c, b, a]);
  });
});
