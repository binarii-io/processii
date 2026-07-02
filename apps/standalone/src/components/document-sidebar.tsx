import { useRef, useState } from 'react';
import { Button } from '@binarii/processii/ui';
import { Globe, LogIn, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';

/**
 * Local space sidebar: document list, creation, **rename/delete** (on hover),
 * and **bundle** import/export (new space or merge). Everything is local — no account, no
 * backend (`docs/01`).
 */
/** Metadata of a sidebar document (optional parent for sub-process nesting). */
export interface SidebarDoc {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
}

interface DocNode {
  readonly doc: SidebarDoc;
  readonly children: DocNode[];
}

/** Rebuilds the forest (roots + children) from the flat list via `parentId` (orphan = root). */
function buildForest(documents: readonly SidebarDoc[]): DocNode[] {
  const nodes = new Map<string, DocNode>();
  for (const doc of documents) nodes.set(doc.id, { doc, children: [] });
  const roots: DocNode[] = [];
  for (const doc of documents) {
    const node = nodes.get(doc.id)!;
    const parent = doc.parentId ? nodes.get(doc.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface DocumentSidebarProps {
  readonly documents: readonly SidebarDoc[];
  readonly activeId: string | null;
  /** Document currently **connected** online (colored globe). */
  readonly liveId?: string | null;
  /** Documents that are **durable shared sessions** (globe shown, colored when connected). */
  readonly sessionIds?: ReadonlySet<string>;
  onSelect(id: string): void;
  onCreate(): void;
  /** Opens the "Join a room" dialog (credential entry). */
  onJoinRoom(): void;
  /** Reorders a sibling group (drag-and-drop): `orderedIds` = the siblings in the new order. */
  onReorder(orderedIds: string[]): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onExport(): void;
  onImportNew(file: File): void;
  onImportMerge(file: File): void;
}

export function DocumentSidebar(props: DocumentSidebarProps) {
  const newInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  // In-place rename: id of the document being edited + buffer value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // **Sibling reordering** drag-and-drop (same parent): moved doc + target line/zone.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropAfter, setDropAfter] = useState(false);

  const docParent = (id: string): string | null =>
    props.documents.find((d) => d.id === id)?.parentId ?? null;
  // Siblings (same parent, display order) with `draggingId` (re)placed before/after `targetId`.
  const reorderedSiblings = (targetId: string, after: boolean): string[] => {
    const parent = docParent(targetId);
    const ids = props.documents
      .filter((d) => (d.parentId ?? null) === parent && d.id !== draggingId)
      .map((d) => d.id);
    const idx = ids.indexOf(targetId);
    ids.splice(after ? idx + 1 : idx, 0, draggingId!);
    return ids;
  };
  const endDrag = (): void => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  const handleFile =
    (handler: (file: File) => void) =>
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (file) handler(file);
      event.target.value = '';
    };

  const startEdit = (id: string, name: string): void => {
    setEditingId(id);
    setDraft(name);
  };

  const commitEdit = (): void => {
    if (editingId) props.onRename(editingId, draft);
    setEditingId(null);
  };

  const cancelEdit = (): void => setEditingId(null);

  const handleDelete = (id: string, name: string, linked: boolean, hasChildren: boolean): void => {
    // Definitive deletion of the local content: confirmed (offline data loss). In cascade, the
    // sub-documents go too; a linked sub-process additionally breaks the link from the parent step.
    const message = hasChildren
      ? `Supprimer « ${name} » et tous ses sous-documents ? Cette action est définitive.`
      : linked
        ? `« ${name} » est un sous-process lié à une étape d'un autre whiteboard. Le supprimer cassera ce lien (l'étape pointera dans le vide). Continuer ?`
        : `Supprimer le document « ${name} » ? Cette action est définitive.`;
    const ok =
      typeof window === 'undefined' || typeof window.confirm !== 'function'
        ? true
        : window.confirm(message);
    if (ok) props.onDelete(id);
  };

  // Renders a document + its nested children (sub-processes), indented by depth.
  const renderNode = (node: DocNode, depth: number): React.JSX.Element => {
    const doc = node.doc;
    const active = doc.id === props.activeId;
    const rowBg = active ? 'bg-accent-subtle' : 'hover:bg-bg';
    // Linked sub-process: a child document (parentId) is attached to a step of its parent.
    const linkedSubprocess = !!doc.parentId;
    const onTarget = dropTargetId === doc.id;
    // Reordering only among **siblings of the same parent** (no reparenting: everything is a whiteboard).
    const canDropHere =
      draggingId !== null && draggingId !== doc.id && docParent(draggingId) === docParent(doc.id);
    return (
      <li key={doc.id}>
        <div
          draggable={editingId !== doc.id}
          onDragStart={(e) => {
            e.stopPropagation();
            setDraggingId(doc.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', doc.id);
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => {
            if (!canDropHere) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            if (dropTargetId !== doc.id) setDropTargetId(doc.id);
            if (dropAfter !== after) setDropAfter(after);
          }}
          onDrop={(e) => {
            if (!canDropHere) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            props.onReorder(reorderedSiblings(doc.id, e.clientY > r.top + r.height / 2));
            endDrag();
          }}
          className={`group relative flex items-center rounded-md ${rowBg}`}
          style={depth > 0 ? { paddingLeft: depth * 14 } : undefined}
        >
          {onTarget && !dropAfter && (
            <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
          )}
          {onTarget && dropAfter && (
            <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
          )}
          {editingId === doc.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              aria-label={`Nom du document ${doc.name}`}
              className="min-w-0 flex-1 rounded-md border border-accent bg-input px-3 py-2 text-sm text-text outline-none"
              maxLength={80}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => props.onSelect(doc.id)}
                onDoubleClick={() => startEdit(doc.id, doc.name)}
                aria-current={active ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left text-sm text-text"
              >
                {props.sessionIds?.has(doc.id) && (
                  <Globe
                    size={13}
                    aria-label={
                      doc.id === props.liveId ? 'Session en ligne' : 'Session partagée (hors ligne)'
                    }
                    className={`shrink-0 ${doc.id === props.liveId ? 'text-success' : 'text-muted'}`}
                  />
                )}
                <span className="truncate">{doc.name}</span>
              </button>
              {linkedSubprocess && (
                <TriangleAlert
                  size={14}
                  role="img"
                  aria-label="Lié comme sous-process"
                  className="shrink-0 text-warning"
                />
              )}
              <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => startEdit(doc.id, doc.name)}
                  aria-label={`Renommer ${doc.name}`}
                  title="Renommer"
                  className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-text"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDelete(doc.id, doc.name, linkedSubprocess, node.children.length > 0)
                  }
                  aria-label={`Supprimer ${doc.name}`}
                  title="Supprimer"
                  className="rounded p-1.5 text-muted hover:bg-danger-subtle hover:text-danger"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
        {node.children.length > 0 && (
          <ul className="flex flex-col gap-1">
            {node.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Documents de l'espace" className="flex h-full flex-col gap-3 bg-bg p-3">
      <Button size="sm" variant="secondary" onClick={props.onJoinRoom}>
        <LogIn aria-hidden className="size-4" />
        Rejoindre une room
      </Button>
      <Button size="sm" onClick={props.onCreate}>
        <Plus aria-hidden className="size-4" />
        Créer un whiteboard
      </Button>

      <ul className="flex flex-1 flex-col gap-1 overflow-auto" aria-label="Liste des documents">
        {buildForest(props.documents).map((node) => renderNode(node, 0))}
        {props.documents.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted">Aucun document.</li>
        )}
      </ul>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Button size="sm" variant="secondary" onClick={props.onExport}>
          Exporter le bundle
        </Button>
        <Button size="sm" variant="secondary" onClick={() => newInputRef.current?.click()}>
          Importer (nouvel espace)
        </Button>
        <Button size="sm" variant="secondary" onClick={() => mergeInputRef.current?.click()}>
          Importer (fusion)
        </Button>
        <input
          ref={newInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Importer un bundle dans un nouvel espace"
          onChange={handleFile(props.onImportNew)}
        />
        <input
          ref={mergeInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Fusionner un bundle dans l'espace courant"
          onChange={handleFile(props.onImportMerge)}
        />
      </div>
    </nav>
  );
}
