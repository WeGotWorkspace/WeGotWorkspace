import * as Y from "yjs";

/**
 * Shared-type key for a title stored in the collaborative document.
 *
 * The key string stays `note-title` so a document that already adopted it
 * still reads. Docs binds the body to the `default` XmlFragment and does not
 * create this type, so a Docs save omits the title.
 */
export const NOTE_TITLE_YTEXT_KEY = "note-title";

/** True once the title shared type exists, including a deliberate blank. */
export function noteTitleIsInDoc(doc: Y.Doc): boolean {
  return doc.share.has(NOTE_TITLE_YTEXT_KEY);
}

/**
 * Title in the document, or `summary` while that type does not exist.
 * Reading does not create the type. `SUMMARY` stays the display fallback
 * until a real edit writes the Y.Text.
 */
export function readNoteTitle(doc: Y.Doc, summary?: string | null): string {
  if (!noteTitleIsInDoc(doc)) return summary ?? "";
  return doc.getText(NOTE_TITLE_YTEXT_KEY).toString();
}

/**
 * Replace the title text. Safe without a mounted editor: a later headless
 * rename can load a Y.Doc, call this, and save. This function does not fetch
 * or store the document.
 *
 * The shared type is created on the first write, with this doc's client id.
 * `getText` is not called until the key is already in `doc.share` or this
 * call is about to insert. An empty `getText` would register the type and
 * the next save would send `title: ""`.
 */
export function writeNoteTitle(doc: Y.Doc, next: string): void {
  if (!doc.share.has(NOTE_TITLE_YTEXT_KEY)) {
    doc.transact(() => {
      const text = doc.getText(NOTE_TITLE_YTEXT_KEY);
      if (next.length > 0) {
        text.insert(0, next);
        return;
      }
      // An empty insert does not put the type in the encoded state.
      text.insert(0, " ");
      text.delete(0, 1);
    });
    return;
  }

  const text = doc.getText(NOTE_TITLE_YTEXT_KEY);
  const current = text.toString();
  if (current === next) return;
  doc.transact(() => {
    replaceNoteTitle(text, current, next);
  });
}

/**
 * Title to send as SUMMARY. Undefined when the doc has no title type yet, so a
 * body save does not clear a SUMMARY the document has not adopted.
 */
export function noteTitleForSave(doc: Y.Doc): string | undefined {
  if (!noteTitleIsInDoc(doc)) return undefined;
  return readNoteTitle(doc);
}

function replaceNoteTitle(text: Y.Text, current: string, next: string): void {
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) {
    start += 1;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }
  if (endCurrent > start) text.delete(start, endCurrent - start);
  const inserted = next.slice(start, endNext);
  if (inserted.length > 0) text.insert(start, inserted);
}
