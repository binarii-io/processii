/**
 * Undo/redo history — backed by Yjs's **`Y.UndoManager`** (hence consistent with the CRDT and
 * collab). No home-made stack reinvention: the UndoManager groups close-in-time mutations into
 * one step (drag = a single undo) and, **scoped to the board's local origin**, only undoes
 * **this user's** edits — never those received from a peer (`board.ts` tags its transactions
 * with a dedicated origin).
 *
 * This module only exposes a minimal, **Yjs-type-free** facade: the rest of the app (and the
 * other packages) depend only on this interface.
 */
import type * as Y from 'yjs';

/** Undo/redo facade (no Yjs type leaks). */
export interface WhiteboardHistory {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Cuts the temporal merging: the next mutation starts a new undo step. */
  stopCapturing(): void;
  /** Clears the undo/redo stacks. */
  clear(): void;
  /** Subscribes to stack changes (to refresh `canUndo`/`canRedo`). Returns the unsubscriber. */
  observe(handler: () => void): () => void;
  /** Releases the resources (Yjs listeners). */
  destroy(): void;
}

/** Wraps a `Y.UndoManager` in the `WhiteboardHistory` facade. */
export function wrapUndoManager(manager: Y.UndoManager): WhiteboardHistory {
  return {
    undo: () => {
      manager.undo();
    },
    redo: () => {
      manager.redo();
    },
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    stopCapturing: () => manager.stopCapturing(),
    clear: () => manager.clear(),
    observe: (handler) => {
      manager.on('stack-item-added', handler);
      manager.on('stack-item-popped', handler);
      return () => {
        manager.off('stack-item-added', handler);
        manager.off('stack-item-popped', handler);
      };
    },
    destroy: () => manager.destroy(),
  };
}
