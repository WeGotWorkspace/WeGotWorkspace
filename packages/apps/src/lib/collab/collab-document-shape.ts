import type * as Y from "yjs";

/**
 * A document shape the shared collab session can carry besides the editor
 * fragment (Docs/Notes) and text-fields (Tasks): its own Yjs roots, its own
 * file text. Sheets spike (#sheets-collab): YCSV registers one.
 *
 * Everything the session does with the body goes through these four calls:
 * emptiness, the deterministic seed, and reading the file text back. An app
 * registers its shape once at startup and names it in `urls.documentShape`.
 */
export type CollabDocumentShape = {
  id: string;
  /** True when `doc` holds this shape's roots (a fresh doc from IndexedDB or a snapshot). */
  recognises(doc: Y.Doc): boolean;
  /** No body yet. Must not create a shared type. */
  isEmpty(doc: Y.Doc): boolean;
  /** The file text a save sends. Reads only. */
  read(doc: Y.Doc): string;
  /**
   * Write `text` into `target` as the deterministic seed: every client that
   * seeds the same text with the same `salt` produces byte-identical items.
   */
  seed(target: Y.Doc, text: string, options: { origin: string; salt?: string }): void;
};

const shapes = new Map<string, CollabDocumentShape>();
const marked = new WeakMap<Y.Doc, CollabDocumentShape>();

export function registerCollabDocumentShape(shape: CollabDocumentShape): void {
  shapes.set(shape.id, shape);
}

export function collabDocumentShapeById(id: string | undefined): CollabDocumentShape | null {
  return id ? (shapes.get(id) ?? null) : null;
}

/** The session marks its document before IndexedDB loads, so an empty one is known. */
export function markCollabShapeDoc(doc: Y.Doc, shape: CollabDocumentShape): void {
  marked.set(doc, shape);
}

/** The shape of `doc`: the one its session marked, or a registered shape that recognises it. */
export function collabShapeOf(doc: Y.Doc): CollabDocumentShape | null {
  const mark = marked.get(doc);
  if (mark) return mark;
  for (const shape of shapes.values()) {
    if (shape.recognises(doc)) return shape;
  }
  return null;
}
