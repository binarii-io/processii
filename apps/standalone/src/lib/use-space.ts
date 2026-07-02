import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyScene, type Participant, type Scene } from '@binarii/processii';
import {
  bundleToNewSpace,
  mergeBundleIntoSpace,
  parseBundle,
  toBundleString,
  type BundleDocument,
} from '../bundle.js';
import { mountDocument, snapshotDocument, type MountedDocument } from './space.js';

/**
 * Reactive state of the standalone site's **local space** (multi-document). Manages the document
 * list, the active document, and the **bundle** imports/exports (new space **or** merge with ID
 * remapping — `bundle.ts`). Engine mount/unmount goes through `space.ts` (injected adapters).
 * Minimal React framework: the business logic stays in `bundle.ts`/`space.ts` (tested purely,
 * outside React).
 */
export interface SpaceApi {
  readonly documents: readonly { id: string; name: string; parentId?: string }[];
  readonly active: MountedDocument | null;
  /**
   * Creates a document; returns its id. `opts.parentId` nests it under a parent (sub-process).
   * `opts.open` (default `true`) opens the created document; `false` stays on the current one
   * (sub-process case: it is entered later via double-click).
   */
  createDocument(name?: string, opts?: { parentId?: string; open?: boolean }): string;
  openDocument(id: string): void;
  /**
   * Reorders a **sibling group**: `orderedIds` = these documents in the new order. Reorders the
   * local array (the other docs do not move); persisted (localStorage + bundle).
   */
  reorderDocuments(orderedIds: string[]): void;
  /** Renames a document (empty name → "Document"). */
  renameDocument(id: string, name: string): void;
  /** Removes a document (unmounts its engine); reassigns the active document if needed. */
  removeDocument(id: string): void;
  /** Exports all documents as a JSON string (content of the `.json` file). */
  exportBundle(): string;
  /** Imports a bundle (JSON string or object) into a new space (replaces everything). */
  importAsNewSpace(input: unknown): void;
  /** Imports a bundle merged into the current space, with ID remapping. */
  importMerge(input: unknown): void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `doc-${Date.now().toString(36)}-${counter}`;
}

/** localStorage key of the space's document **list** (content lives in per-doc IndexedDB). */
const SPACE_KEY = 'memorii.whiteboard.space';

/** Empty scene? (no element/lane/group) → no need for `loadScene` on mount (IndexedDB hydrates). */
function isEmptyScene(scene: Scene): boolean {
  return (
    scene.elements.length === 0 && scene.swimlanes.length === 0 && scene.agentGroups.length === 0
  );
}

/** Reads the persisted list (id+name metadata); each doc's content is reloaded from IndexedDB. */
function loadSpaceList(): BundleDocument[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SPACE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d): d is { id: string; name: string; parentId?: string } =>
          typeof d === 'object' &&
          d !== null &&
          typeof (d as { id?: unknown }).id === 'string' &&
          typeof (d as { name?: unknown }).name === 'string',
      )
      .map((d) => ({
        id: d.id,
        name: d.name,
        scene: emptyScene(),
        ...(typeof d.parentId === 'string' ? { parentId: d.parentId } : {}),
      }));
  } catch {
    return [];
  }
}

/** Persists the list (id+name only); ignored when localStorage is absent (SSR/tests). */
function saveSpaceList(docs: readonly BundleDocument[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      SPACE_KEY,
      JSON.stringify(
        docs.map((d) => ({
          id: d.id,
          name: d.name,
          ...(d.parentId ? { parentId: d.parentId } : {}),
        })),
      ),
    );
  } catch {
    /* quota / private mode: silently ignored */
  }
}

export interface UseSpaceOptions {
  readonly participant: Participant;
  /** Builds a local persistence for a document id (offline-first). */
  persistenceFactoryFor?: (
    documentId: string,
  ) => import('@binarii/processii').PersistenceProviderFactory;
}

export function useSpace(options: UseSpaceOptions): SpaceApi {
  // Local list persistence: enabled only when a per-document persistence is too
  // (otherwise demo/E2E mode → ephemeral state).
  const persistEnabled = !!options.persistenceFactoryFor;
  // Document metadata (source of truth of the list). The scenes live in the engines.
  const [docs, setDocs] = useState<BundleDocument[]>(() => (persistEnabled ? loadSpaceList() : []));
  const [activeId, setActiveId] = useState<string | null>(() =>
    persistEnabled ? (loadSpaceList()[0]?.id ?? null) : null,
  );
  // Cache of the mounted engines (one per open document).
  const mounted = useRef<Map<string, MountedDocument>>(new Map());

  // Saves the list on every change (each doc's content is persisted by IndexedDB).
  useEffect(() => {
    if (persistEnabled) saveSpaceList(docs);
  }, [docs, persistEnabled]);

  const mount = useCallback(
    (doc: BundleDocument): MountedDocument => {
      const existing = mounted.current.get(doc.id);
      if (existing) return existing;
      const persistenceFactory = options.persistenceFactoryFor?.(doc.id);
      const m = mountDocument({
        id: doc.id,
        name: doc.name,
        participant: options.participant,
        // Empty scene (fresh or restored doc) → IndexedDB rehydrates; otherwise (import) it is loaded.
        ...(isEmptyScene(doc.scene) ? {} : { initialScene: doc.scene }),
        ...(persistenceFactory ? { persistenceFactory } : {}),
      });
      mounted.current.set(doc.id, m);
      return m;
    },
    [options],
  );

  const createDocument = useCallback(
    (name?: string, opts?: { parentId?: string; open?: boolean }): string => {
      const doc: BundleDocument = {
        id: nextId(),
        name: name && name.trim().length > 0 ? name.trim() : 'Document',
        scene: emptyScene(),
        ...(opts?.parentId ? { parentId: opts.parentId } : {}),
      };
      setDocs((prev) => [...prev, doc]);
      if (opts?.open !== false) setActiveId(doc.id);
      return doc.id;
    },
    [],
  );

  const openDocument = useCallback((id: string) => setActiveId(id), []);

  const reorderDocuments = useCallback((orderedIds: string[]) => {
    if (orderedIds.length === 0) return;
    const set = new Set(orderedIds);
    setDocs((prev) => {
      const byId = new Map(prev.map((d) => [d.id, d]));
      if (!orderedIds.every((id) => byId.has(id))) return prev;
      // At each slot occupied by a group member, the next member in the desired order is placed;
      // the other documents keep their slot. → reorders the siblings "in place".
      let k = 0;
      return prev.map((d) => (set.has(d.id) ? byId.get(orderedIds[k++]!)! : d));
    });
  }, []);

  const renameDocument = useCallback((id: string, name: string) => {
    const clean = name.trim().length > 0 ? name.trim() : 'Document';
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name: clean } : d)));
  }, []);

  const removeDocument = useCallback(
    (id: string) => {
      // **Cascade**: removes the document **and all its descendants** (sub-processes included).
      // The subtree is collected via `parentId`, each engine unmounted, then everything removed.
      const childrenByParent = new Map<string, string[]>();
      for (const d of docs) {
        if (d.parentId) {
          const list = childrenByParent.get(d.parentId);
          if (list) list.push(d.id);
          else childrenByParent.set(d.parentId, [d.id]);
        }
      }
      const toDelete = new Set<string>();
      const stack = [id];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (toDelete.has(cur)) continue;
        toDelete.add(cur);
        for (const child of childrenByParent.get(cur) ?? []) stack.push(child);
      }
      for (const did of toDelete) {
        const m = mounted.current.get(did);
        if (m) {
          m.dispose();
          mounted.current.delete(did);
        }
      }
      const next = docs.filter((d) => !toDelete.has(d.id));
      setDocs(next);
      // When the active document is part of the removed subtree, switch to the first remaining one.
      if (activeId && toDelete.has(activeId)) setActiveId(next[0]?.id ?? null);
    },
    [docs, activeId],
  );

  const replaceSpace = useCallback((next: BundleDocument[]) => {
    // Unmounts everything no longer present.
    for (const [id, m] of mounted.current) {
      if (!next.some((d) => d.id === id)) {
        m.dispose();
        mounted.current.delete(id);
      }
    }
    setDocs(next);
    setActiveId(next[0]?.id ?? null);
  }, []);

  const snapshotAll = useCallback((): BundleDocument[] => {
    return docs.map((d) => {
      const m = mounted.current.get(d.id);
      // The list (`docs`) is authoritative for the **name** and the **parent**: the mounted doc
      // keeps its mount-time name (a rename does not remount it) and does not know its parent.
      // The mounted engine's scene is taken but the up-to-date name + parentId from the list.
      return m
        ? { ...snapshotDocument(m), name: d.name, ...(d.parentId ? { parentId: d.parentId } : {}) }
        : d;
    });
  }, [docs]);

  const exportBundle = useCallback(() => toBundleString(snapshotAll()), [snapshotAll]);

  const importAsNewSpace = useCallback(
    (input: unknown) => {
      const bundle = parseBundle(input);
      // New space: everything existing is unmounted.
      for (const [, m] of mounted.current) m.dispose();
      mounted.current.clear();
      replaceSpace(bundleToNewSpace(bundle));
    },
    [replaceSpace],
  );

  const importMerge = useCallback(
    (input: unknown) => {
      const bundle = parseBundle(input);
      const merged = mergeBundleIntoSpace(snapshotAll(), bundle);
      setDocs(merged);
    },
    [snapshotAll],
  );

  const active = useMemo(() => {
    if (!activeId) return null;
    const doc = docs.find((d) => d.id === activeId);
    return doc ? mount(doc) : null;
  }, [activeId, docs, mount]);

  return {
    documents: docs.map((d) => ({
      id: d.id,
      name: d.name,
      ...(d.parentId ? { parentId: d.parentId } : {}),
    })),
    active,
    createDocument,
    openDocument,
    reorderDocuments,
    renameDocument,
    removeDocument,
    exportBundle,
    importAsNewSpace,
    importMerge,
  };
}
