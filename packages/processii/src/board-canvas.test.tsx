import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyAwarenessUpdate,
  createAwareness,
  createDoc,
  encodeAwarenessUpdate,
} from './crdt/index.js';
import { createEngine, type WhiteboardEngine } from './engine.js';
import { createMemoryClipboard } from './clipboard.js';
import { publishCursor, publishIdentity } from './presence.js';
import { BoardCanvas } from './board-canvas.js';

/**
 * Canvas interaction tests (Lot 1): the component is mounted on a real engine and pointer
 * gestures are simulated. Under jsdom, `getContext('2d')` is absent (pixel rendering no-op) and
 * `getBoundingClientRect` returns the origin (0,0) → client coordinates equal world coordinates
 * (identity viewport). We therefore verify the **gesture routing to the engine**, not the rendering.
 */
function setup(prepare: (engine: WhiteboardEngine) => void) {
  const engine = createEngine({ clientId: 1 });
  prepare(engine);
  const utils = render(<BoardCanvas engine={engine} width={400} height={300} />);
  const canvas = utils.getByLabelText('Surface de dessin du whiteboard');
  return { engine, canvas, ...utils };
}

afterEach(() => {
  // RTL cleans the DOM between tests via auto cleanup (jsdom) — nothing to do here.
});

describe('BoardCanvas — click selection', () => {
  it('selects the element under the cursor', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 },
        { select: false },
      );
    });
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 30, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 30, button: 0, pointerId: 1 });
    expect(engine.getSelection()).toEqual(['a']);
  });

  it('a click in empty space clears the selection', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 });
    });
    expect(engine.getSelection()).toEqual(['a']);
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 250, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 300, clientY: 250, button: 0, pointerId: 1 });
    expect(engine.getSelection()).toEqual([]);
  });

  it('shift+click adds then removes from the selection (multi)', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 50, height: 50 },
        { select: false },
      );
      e.addElement(
        { kind: 'rectangle', id: 'b', x: 100, y: 0, width: 50, height: 50 },
        { select: false },
      );
    });
    fireEvent.pointerDown(canvas, { clientX: 25, clientY: 25, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 25, button: 0, pointerId: 1 });
    fireEvent.pointerDown(canvas, {
      clientX: 125,
      clientY: 25,
      button: 0,
      shiftKey: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, {
      clientX: 125,
      clientY: 25,
      button: 0,
      shiftKey: true,
      pointerId: 1,
    });
    expect(new Set(engine.getSelection())).toEqual(new Set(['a', 'b']));
    // shift+click on b again → removes it.
    fireEvent.pointerDown(canvas, {
      clientX: 125,
      clientY: 25,
      button: 0,
      shiftKey: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(canvas, {
      clientX: 125,
      clientY: 25,
      button: 0,
      shiftKey: true,
      pointerId: 1,
    });
    expect(engine.getSelection()).toEqual(['a']);
  });
});

describe('BoardCanvas — marquee', () => {
  it('a selection rectangle catches the intersected elements', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 40, height: 40 },
        { select: false },
      );
      e.addElement(
        { kind: 'rectangle', id: 'b', x: 300, y: 200, width: 40, height: 40 },
        { select: false },
      );
    });
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    expect(engine.getSelection()).toEqual(['a']);
  });
});

describe('BoardCanvas — drag move', () => {
  it('dragging a selected element moves it', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 },
        { select: false },
      );
    });
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 30, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 70, clientY: 45, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 70, clientY: 45, button: 0, pointerId: 1 });
    expect(engine.board.getElement('a')).toMatchObject({ x: 20, y: 15 });
  });
});

describe('BoardCanvas — handles (single selection)', () => {
  it('dragging the se handle resizes the element', () => {
    const { engine, canvas } = setup((e) => {
      // Selected by default → handles displayed.
      e.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 });
    });
    // 'se' handle at the corner (100,60).
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 60, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 150, clientY: 100, button: 0, pointerId: 1 });
    expect(engine.board.getElement('a')).toMatchObject({ x: 0, y: 0, width: 150, height: 100 });
  });

  it('dragging the rotation handle rotates the element', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 });
    });
    // Rotation handle: above the center (50, -22).
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: -22, button: 0, pointerId: 1 });
    // Pulling to the right of the center → +90°.
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 30, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 30, button: 0, pointerId: 1 });
    expect(engine.board.getElement('a')?.angle).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('BoardCanvas — in-place text editing', () => {
  it('double-click on a text opens the editor, Enter commits the change', () => {
    const { engine, canvas, getByLabelText } = setup((e) => {
      e.addElement({ kind: 'text', id: 't', x: 0, y: 0, width: 120, height: 40, text: 'avant' });
    });
    fireEvent.doubleClick(canvas, { clientX: 10, clientY: 10 });
    const editor = getByLabelText('Éditer le texte');
    editor.textContent = 'après';
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(engine.board.getElement('t')).toMatchObject({ text: 'après' });
  });

  it('double-click on a rectangle writes a centered label inside it (Enter commits)', () => {
    const { engine, canvas, getByLabelText } = setup((e) => {
      e.addElement({ kind: 'rectangle', id: 'r', x: 0, y: 0, width: 120, height: 80 });
    });
    fireEvent.doubleClick(canvas, { clientX: 10, clientY: 10 });
    const editor = getByLabelText('Éditer le texte');
    editor.textContent = 'Bonjour';
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(engine.board.getElement('r')).toMatchObject({ kind: 'rectangle', text: 'Bonjour' });
  });

  it('double-click on an ellipse writes a label inside it', () => {
    const { engine, canvas, getByLabelText } = setup((e) => {
      e.addElement({ kind: 'ellipse', id: 'o', x: 0, y: 0, width: 120, height: 80 });
    });
    // Center of the oval (the corners are outside the ellipse for the hit-test).
    fireEvent.doubleClick(canvas, { clientX: 60, clientY: 40 });
    const editor = getByLabelText('Éditer le texte');
    editor.textContent = 'Idée';
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(engine.board.getElement('o')).toMatchObject({ kind: 'ellipse', text: 'Idée' });
  });
});

describe('BoardCanvas — process board', () => {
  it('double-click on a step edits its name', () => {
    const { engine, canvas, getByLabelText } = setup((e) => {
      e.addElement({ kind: 'step', id: 's', x: 0, y: 0, width: 200, height: 120, name: 'A' });
    });
    fireEvent.doubleClick(canvas, { clientX: 20, clientY: 20 });
    const editor = getByLabelText('Éditer le texte');
    editor.textContent = 'Rédiger';
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(engine.board.getElement('s')).toMatchObject({ name: 'Rédiger' });
  });

  it('a moved element snaps to a swimlane edge', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'X', order: 0, color: 'green', height: 160 });
    engine.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 200, width: 100, height: 60 });
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={600} height={500} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    // Drags the element up: its proposed top lands ~3px from the lane top (y=0) → snaps to 0.
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 230, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 33, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 33, button: 0, pointerId: 1 });
    expect(engine.board.getElement('a')?.y).toBe(0);
  });

  it('dragging the bottom edge of a lane changes its height', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'X', order: 0, color: 'green', height: 160 });
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={400} height={300} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 160, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 240, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 240, button: 0, pointerId: 1 });
    expect(engine.listSwimlanes()[0]?.height).toBe(240);
  });

  it("dragging the right edge changes the cluster's width", () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'X', order: 0, color: 'green', height: 160 });
    engine.setSwimlanesWidth(300); // legacy cluster starts 300 wide (x = 0)
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={600} height={400} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 420, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 420, clientY: 50, button: 0, pointerId: 1 });
    expect(engine.listSwimlaneClusters()[0]?.width).toBe(420);
  });

  it('dragging a lane header reorders it (drag-and-drop)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'A', order: 0, color: 'green', height: 160 }); // lane 0..160
    engine.addSwimlane({ id: 'l2', name: 'B', order: 1, color: 'blue', height: 160 }); // lane 160..320
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={400} height={400} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    // Grabs the l1 header (top-left corner) and drags it into the **bottom half** of l2 (y=300,
    // lane l2 = 160..320, middle 240) → drop BELOW l2; commit on release → l1 becomes 2nd.
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 14, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 300, button: 0, pointerId: 1 });
    expect(engine.listSwimlanes().map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('clicking a lane header selects it', () => {
    let selected: string | null = null;
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', name: 'Métier', order: 0, color: 'green', height: 160 });
    const { getByLabelText } = render(
      <BoardCanvas
        engine={engine}
        width={400}
        height={300}
        onSelectLane={(id) => {
          selected = id;
        }}
      />,
    );
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 10, button: 0, pointerId: 1 });
    expect(selected).toBe('l1');
  });

  it('dragging the cluster grip moves the whole block and its content', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 200 });
    engine.updateSwimlaneCluster('cluster:legacy', { x: 0, y: 0, width: 1000 });
    engine.addElement(
      { kind: 'step', id: 's', x: 20, y: 50, width: 40, height: 30 },
      { select: false },
    );
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={600} height={500} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    // Grabs the left-edge grip (x∈[0,12]) and drags the block by (100, 30).
    fireEvent.pointerDown(canvas, { clientX: 6, clientY: 50, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 106, clientY: 80, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 106, clientY: 80, button: 0, pointerId: 1 });
    expect(engine.listSwimlaneClusters()[0]).toMatchObject({ x: 100, y: 30 });
    expect(engine.board.getElement('s')).toMatchObject({ x: 120, y: 80 });
  });

  it('dragging a lane header far away detaches it into its own cluster', () => {
    const engine = createEngine({ clientId: 1 });
    engine.setSwimlanesWidth(300);
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // 0..100
    engine.addSwimlane({ id: 'l2', order: 1, height: 100 }); // 100..200
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={600} height={500} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    // Grabs the l2 header and drags it well to the right of the 300-wide block → detach.
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 110, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 900, clientY: 110, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 900, clientY: 110, button: 0, pointerId: 1 });
    expect(engine.listSwimlaneClusters()).toHaveLength(2);
    expect(engine.listSwimlanes().find((l) => l.id === 'l2')?.clusterId).toBe('cluster-of:l2');
  });

  it('a plain click on the cluster grip selects the lane under it (does not just deselect)', () => {
    let selected: string | null = 'sentinel';
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'l1', order: 0, height: 100 }); // 0..100
    engine.addSwimlane({ id: 'l2', order: 1, height: 100 }); // 100..200
    const { getByLabelText } = render(
      <BoardCanvas
        engine={engine}
        width={600}
        height={500}
        onSelectLane={(id) => {
          selected = id;
        }}
      />,
    );
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    // Click (no drag) in the grip strip (x∈[0,12]) at l2's row → selects l2.
    fireEvent.pointerDown(canvas, { clientX: 6, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 6, clientY: 150, button: 0, pointerId: 1 });
    expect(selected).toBe('l2');
  });

  it('dragging a detached lane onto another cluster re-attaches it (magnetic)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addSwimlane({ id: 'a1', clusterId: 'A', order: 0, height: 100 });
    engine.addSwimlane({ id: 'a2', clusterId: 'A', order: 1, height: 100 });
    engine.addSwimlaneCluster({ id: 'A', x: 0, y: 0, width: 300 });
    engine.addSwimlane({ id: 'l3', clusterId: 'X', order: 0, height: 100 });
    engine.addSwimlaneCluster({ id: 'X', x: 600, y: 600, width: 300 });
    const { getByLabelText } = render(<BoardCanvas engine={engine} width={1000} height={800} />);
    const canvas = getByLabelText('Surface de dessin du whiteboard');
    // Grabs l3's header (at cluster X) and drops it on cluster A's bottom edge → attach below a2.
    fireEvent.pointerDown(canvas, { clientX: 620, clientY: 610, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 205, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 150, clientY: 205, button: 0, pointerId: 1 });
    const l3 = engine.listSwimlanes().find((l) => l.id === 'l3');
    expect(l3?.clusterId).toBe('A');
    expect(l3?.order).toBe(2);
    expect(
      engine
        .listSwimlaneClusters()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['A']);
  });
});

describe('BoardCanvas — presence cursors', () => {
  it('displays a peer cursor (awareness)', () => {
    const engine = createEngine({ clientId: 1 });
    const awareness = createAwareness(engine.board.doc);
    // Distinct peer publishing a cursor, propagated to our awareness.
    const peer = createAwareness(createDoc({ clientId: 2 }));
    publishIdentity(peer, { id: 'p', name: 'Alice', color: 'accent' });
    publishCursor(peer, { x: 100, y: 80 });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'test');

    const { getByText } = render(
      <BoardCanvas engine={engine} width={400} height={300} awareness={awareness} />,
    );
    expect(getByText('Alice')).toBeInTheDocument();
  });
});

describe('BoardCanvas — keyboard deletion', () => {
  it('Delete removes the selection', () => {
    const { engine, canvas } = setup((e) => {
      e.addElement({ kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 });
    });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(engine.board.size).toBe(0);
  });
});

describe('BoardCanvas — connection handles (hover)', () => {
  it('shows 4 N/E/S/W handles when hovering a shape', () => {
    const { engine, canvas, queryAllByRole } = setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 },
        { select: false },
      );
    });
    expect(queryAllByRole('button', { name: /^Connecter \(/ })).toHaveLength(0);
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30, pointerId: 1 });
    expect(queryAllByRole('button', { name: /^Connecter \(/ })).toHaveLength(4);
    expect(engine.board.size).toBe(1);
  });

  it('clicking a handle creates the same shape in the direction + a bound connector', () => {
    const { engine, canvas, getByRole } = setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 },
        { select: false },
      );
    });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30, pointerId: 1 });
    const east = getByRole('button', { name: 'Connecter (droite)' });
    // click = pointerdown on the handle then pointerup at the same spot (no drag).
    fireEvent.pointerDown(east, { clientX: 116, clientY: 30, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 116, clientY: 30, button: 0, pointerId: 1 });

    const elements = engine.listElements();
    expect(elements.filter((el) => el.kind === 'rectangle')).toHaveLength(2);
    const arrow = elements.find((el) => el.kind === 'arrow');
    // Default arrow on the destination tip.
    expect(arrow).toMatchObject({ start: 'a', endArrow: true });
    const newRect = elements.find((el) => el.kind === 'rectangle' && el.id !== 'a');
    expect((newRect?.x ?? 0) > 100).toBe(true);
  });
});

describe('BoardCanvas — movable connector elbow', () => {
  function connectorSetup() {
    return setup((e) => {
      e.addElement(
        { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 },
        { select: false },
      );
      e.addElement(
        { kind: 'rectangle', id: 'b', x: 200, y: 160, width: 100, height: 60 },
        { select: false },
      );
      e.connect('c', 'a', 'b'); // h↔h; connector selected by default
    });
  }

  it('shows an elbow handle for a selected connector and drags it', () => {
    const { engine, getByLabelText } = connectorSetup();
    const handle = getByLabelText('Déplacer le coude du connecteur');
    // Handle at the center of the crossing segment (x=150); dragged to x=250.
    fireEvent.pointerDown(handle, { clientX: 150, clientY: 110, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 250, clientY: 110, pointerId: 1 });
    expect(engine.board.getElement('c')?.midpoint).toBe(250);
  });

  it('double-click on the handle recenters the elbow (clears the midpoint)', () => {
    const { engine, getByLabelText } = connectorSetup();
    engine.setConnectorMidpoint('c', 250);
    fireEvent.doubleClick(getByLabelText('Déplacer le coude du connecteur'));
    expect(engine.board.getElement('c')?.midpoint).toBeUndefined();
  });
});

describe('BoardCanvas — sub-process', () => {
  it('double-click on a linked step → navigation (no inline editing)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      {
        kind: 'step',
        id: 's',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        name: 'Étape',
        subprocessRef: 'child-doc',
      },
      { select: false },
    );
    const onNavigateSubprocess = vi.fn();
    const { getByLabelText, queryByRole } = render(
      <BoardCanvas
        engine={engine}
        width={400}
        height={300}
        onNavigateSubprocess={onNavigateSubprocess}
      />,
    );
    fireEvent.doubleClick(getByLabelText('Surface de dessin du whiteboard'), {
      clientX: 60,
      clientY: 40,
    });
    expect(onNavigateSubprocess).toHaveBeenCalledWith('child-doc');
    // The linked step does NOT open the inline editor (we enter the sub-process).
    expect(queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('creating a connected item from a linked step → the new item is **blank** (no sub-process)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      {
        kind: 'step',
        id: 's',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        name: 'Étape',
        subprocessRef: 'child-doc',
      },
      { select: false },
    );
    const { getByRole, getByLabelText } = render(
      <BoardCanvas engine={engine} width={400} height={300} />,
    );
    // Hover → connection handles; clicking "right" creates a step connected in that direction.
    fireEvent.pointerMove(getByLabelText('Surface de dessin du whiteboard'), {
      clientX: 60,
      clientY: 40,
      pointerId: 1,
    });
    const east = getByRole('button', { name: 'Connecter (droite)' });
    fireEvent.pointerDown(east, { clientX: 116, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 116, clientY: 40, button: 0, pointerId: 1 });

    const newStep = engine.listElements().find((el) => el.kind === 'step' && el.id !== 's');
    expect(newStep).toBeDefined();
    // The clone takes the type/size but **not** the sub-process link.
    expect(newStep).not.toHaveProperty('subprocessRef');
  });

  it('double-click on an **unlinked** step → inline editing (unchanged behavior)', () => {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'step', id: 's', x: 0, y: 0, width: 120, height: 80, name: 'Étape' },
      { select: false },
    );
    const { getByLabelText, getByRole } = render(
      <BoardCanvas engine={engine} width={400} height={300} onNavigateSubprocess={vi.fn()} />,
    );
    fireEvent.doubleClick(getByLabelText('Surface de dessin du whiteboard'), {
      clientX: 60,
      clientY: 40,
    });
    expect(getByRole('textbox')).toBeInTheDocument();
  });
});

describe('BoardCanvas — copy / paste keyboard shortcuts', () => {
  function setupClipboard() {
    const engine = createEngine({ clientId: 1 });
    engine.addElement(
      { kind: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 60 },
      { select: false },
    );
    engine.select(['a']);
    const clipboard = createMemoryClipboard();
    const utils = render(
      <BoardCanvas engine={engine} width={400} height={300} clipboard={clipboard} />,
    );
    const canvas = utils.getByLabelText('Surface de dessin du whiteboard');
    return { engine, clipboard, canvas };
  }

  it('Ctrl+C then Ctrl+V pastes a fresh copy and selects it', async () => {
    const { engine, canvas } = setupClipboard();
    fireEvent.keyDown(canvas, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(canvas, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(engine.board.size).toBe(2)); // paste read is async
    const pasted = engine.getSelection();
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).not.toBe('a');
  });

  it('Ctrl+D duplicates the selection in place', () => {
    const { engine, canvas } = setupClipboard();
    fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true });
    expect(engine.board.size).toBe(2);
    expect(engine.getSelection()[0]).not.toBe('a');
  });

  it('Ctrl+X cuts (removes + stashes) then Ctrl+V pastes it back', async () => {
    const { engine, canvas } = setupClipboard();
    fireEvent.keyDown(canvas, { key: 'x', ctrlKey: true });
    expect(engine.board.size).toBe(0); // removed
    fireEvent.keyDown(canvas, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(engine.board.size).toBe(1)); // pasted back
  });

  it('the Meta (⌘) modifier works too', () => {
    const { engine, canvas } = setupClipboard();
    fireEvent.keyDown(canvas, { key: 'd', metaKey: true });
    expect(engine.board.size).toBe(2);
  });
});
