/**
 * **Save bundle** — exchange format of the standalone local space (`docs/01`: "Save bundle
 * import/export, new space **or** merge with ID remapping").
 *
 * A bundle is a **portable, lossless** snapshot of a space: the list of its documents, each
 * being a native `Scene` (`@binarii/processii`). It is exported as a `.json` file (download)
 * and re-imported either into a **new space**, or **merged** into the current space.
 *
 * An imported file is an **untrusted input** (`SECURITY.md`): everything goes through zod at
 * the boundary (`parseBundle`) and each scene is revalidated via `parseScene`. A merge **remaps
 * the IDs** (documents *and* elements) so a bundle imported twice, or merged into a space that
 * already contains its IDs, never **collides** — `arrow`/`line` have no inter-element reference
 * in the native model, so remapping element IDs is side-effect-free.
 */
import { parseScene, type Scene, type WhiteboardElement } from '@binarii/processii';
import { z } from 'zod';

/** Bundle format version (bumped when the content changes shape). */
export const BUNDLE_VERSION = 1 as const;

/** A space document: stable identity + name + native scene (+ optional parent). */
export interface BundleDocument {
  readonly id: string;
  readonly name: string;
  readonly scene: Scene;
  /** Parent document (sub-process): this document is nested under `parentId` in the sidebar. */
  readonly parentId?: string;
}

/** Full serializable space (multi-document). */
export interface SpaceBundle {
  readonly version: typeof BUNDLE_VERSION;
  readonly documents: readonly BundleDocument[];
}

const bundleDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // The scene is revalidated by the native schema (kinds, geometry, colors, markers).
  scene: z.unknown(),
  parentId: z.string().min(1).optional(),
});

const bundleSchema = z.object({
  version: z.literal(BUNDLE_VERSION),
  documents: z.array(bundleDocumentSchema),
});

/** Typed bundle parsing/validation error (import boundary). */
export class BundleParseError extends Error {
  override readonly name = 'BundleParseError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Validates any value (already-parsed object OR JSON string) into a `SpaceBundle`. Each scene is
 * re-run through `parseScene` (`@binarii/processii`) → a malformed bundle throws
 * `BundleParseError` without ever producing a partially invalid space.
 */
export function parseBundle(input: unknown): SpaceBundle {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (cause) {
      throw new BundleParseError('Bundle JSON invalide (parse).', { cause });
    }
  }

  const result = bundleSchema.safeParse(raw);
  if (!result.success) {
    throw new BundleParseError('Bundle invalide (structure).', { cause: result.error });
  }

  let documents: BundleDocument[];
  try {
    documents = result.data.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      scene: parseScene(doc.scene),
      ...(doc.parentId ? { parentId: doc.parentId } : {}),
    }));
  } catch (cause) {
    throw new BundleParseError('Bundle invalide (scène d’un document).', { cause });
  }

  // Document IDs duplicated inside the file itself = inconsistent input → explicit refusal.
  const ids = new Set<string>();
  for (const doc of documents) {
    if (ids.has(doc.id)) {
      throw new BundleParseError(`Bundle invalide : id de document dupliqué « ${doc.id} ».`);
    }
    ids.add(doc.id);
  }

  return { version: BUNDLE_VERSION, documents };
}

/** Serializes a space into a bundle (object ready for `JSON.stringify`). */
export function toBundle(documents: readonly BundleDocument[]): SpaceBundle {
  return { version: BUNDLE_VERSION, documents: documents.map((d) => ({ ...d })) };
}

/** Serializes a space into an indented JSON string (content of the downloaded `.json` file). */
export function toBundleString(documents: readonly BundleDocument[]): string {
  return JSON.stringify(toBundle(documents), null, 2);
}

/** ID generator (injectable for deterministic tests; default = `crypto.randomUUID`). */
export type IdFactory = () => string;

const defaultIdFactory: IdFactory = () => crypto.randomUUID();

/**
 * Deterministic remap: assigns a new ID to each element of a scene (via `idFactory`). When
 * `docIdMap` is provided, also remaps the steps' **`subprocessRef`** (it references a
 * **document id**: on merge, the docs change ids → the link must follow).
 */
function remapScene(scene: Scene, idFactory: IdFactory, docIdMap?: Map<string, string>): Scene {
  const elements: WhiteboardElement[] = scene.elements.map((element) => {
    const remapped = { ...element, id: idFactory() };
    if (
      remapped.kind === 'step' &&
      remapped.subprocessRef &&
      docIdMap?.has(remapped.subprocessRef)
    ) {
      remapped.subprocessRef = docIdMap.get(remapped.subprocessRef);
    }
    return remapped;
  });
  // Keeps the process collections (swimlanes/groups/width); only the ids are remapped.
  return { ...scene, elements };
}

/**
 * **New space**: imports the bundle as-is (the file's IDs become the freshly created space's —
 * no collision possible since the space is empty).
 */
export function bundleToNewSpace(bundle: SpaceBundle): BundleDocument[] {
  return bundle.documents.map((d) => ({ ...d }));
}

/**
 * **Merge** of a bundle into an existing space, with **ID remapping**.
 *
 * Each imported document gets a **new document ID** and each of its elements a **new element
 * ID** (via `idFactory`), so that no ID can collide with those already present (`existing`) —
 * even when re-importing the same file. The result is the **complete** document list (existing
 * first, then the remapped imports), ready to replace the store state.
 */
export function mergeBundleIntoSpace(
  existing: readonly BundleDocument[],
  bundle: SpaceBundle,
  idFactory: IdFactory = defaultIdFactory,
): BundleDocument[] {
  // old→new table over **all** docs first, to be able to remap the links: `parentId`
  // (doc→doc) and `subprocessRef` (step→doc) pointing to other docs **of the bundle**.
  const docIdMap = new Map<string, string>();
  for (const doc of bundle.documents) docIdMap.set(doc.id, idFactory());
  const imported: BundleDocument[] = bundle.documents.map((doc) => {
    const parentNew = doc.parentId ? docIdMap.get(doc.parentId) : undefined;
    return {
      id: docIdMap.get(doc.id)!,
      name: doc.name,
      scene: remapScene(doc.scene, idFactory, docIdMap),
      ...(parentNew ? { parentId: parentNew } : {}),
    };
  });
  return [...existing.map((d) => ({ ...d })), ...imported];
}
