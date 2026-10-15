import * as Y from "yjs";

/**
 * Shared-type key for a note title.
 *
 * Docs binds the body to the `default` XmlFragment and never reads this key,
 * so a title can travel in the same Y.Doc without a Docs change.
 */
export const NOTE_TITLE_YTEXT_KEY = "note-title";

/**
 * Reserved client id for the one-time title seed. The same SUMMARY produces
 * the same update bytes, so two devices that both open a legacy note merge
 * to one title instead of concatenating it. Later edits use the local client
 * id, so concurrent typing still merges.
 */
const NOTE_TITLE_SEED_CLIENT_ID = 0x6e746974;

const MARKDOWN_HEADING_TITLE = /^#{1,6}\s+(.+)$/;

/**
 * First heading or first non-empty line, once that line is complete.
 * Used only to seed a title at create — not to keep SUMMARY in step with the body.
 */
export function titleFromNoteMarkdown(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    if (i === lines.length - 1) return null;
    const heading = MARKDOWN_HEADING_TITLE.exec(trimmed);
    const title = (heading?.[1] ?? trimmed).trim();
    return title || null;
  }
  return null;
}

/** True once the title shared type exists, including a deliberate blank. */
export function noteTitleIsInDoc(doc: Y.Doc): boolean {
  return doc.share.has(NOTE_TITLE_YTEXT_KEY);
}

/** Current title. Empty when the shared type is missing or blank. */
export function readNoteTitle(doc: Y.Doc): string {
  if (!noteTitleIsInDoc(doc)) return "";
  return doc.getText(NOTE_TITLE_YTEXT_KEY).toString();
}

/**
 * Replace the title text. Safe without a mounted editor: a later headless
 * rename can load a Y.Doc, call this, and save. This function does not fetch
 * or store the document.
 */
export function writeNoteTitle(doc: Y.Doc, next: string): void {
  const text = doc.getText(NOTE_TITLE_YTEXT_KEY);
  const current = text.toString();
  if (current === next) return;
  doc.transact(() => {
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

export type NoteTitleSeed = "summary" | "heading" | "skipped";

/**
 * First open of a note whose Y.Doc has no title yet.
 *
 * An existing note copies SUMMARY, including "" when the user blanked it.
 * A create may seed once from the first complete heading when SUMMARY was
 * never set. Later body edits do not move the title.
 */
export function seedNoteTitleOnOpen(
  doc: Y.Doc,
  input: { summary?: string | null; headingMarkdown?: string },
  origin?: unknown,
): NoteTitleSeed {
  if (noteTitleIsInDoc(doc)) return "skipped";
  const chosen = chooseTitleSeed(input);
  if (!chosen) return "skipped";
  applyTitleSeed(doc, chosen.value, origin);
  return chosen.kind;
}

function chooseTitleSeed(input: {
  summary?: string | null;
  headingMarkdown?: string;
}): { value: string; kind: Exclude<NoteTitleSeed, "skipped"> } | null {
  if (input.summary != null) return { value: input.summary, kind: "summary" };
  if (input.headingMarkdown == null) return null;
  const heading = titleFromNoteMarkdown(input.headingMarkdown);
  if (!heading) return null;
  return { value: heading, kind: "heading" };
}

function applyTitleSeed(doc: Y.Doc, value: string, origin: unknown): void {
  if (doc.store.clients.has(NOTE_TITLE_SEED_CLIENT_ID)) {
    writeNoteTitle(doc, value);
    return;
  }
  Y.applyUpdate(doc, encodeTitleSeed(value), origin);
}

function encodeTitleSeed(value: string): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = NOTE_TITLE_SEED_CLIENT_ID;
  // An empty insert does not create the shared type in the encoded state.
  // Insert-and-delete leaves the type present and the text blank.
  seed.transact(() => {
    const text = seed.getText(NOTE_TITLE_YTEXT_KEY);
    if (value.length > 0) {
      text.insert(0, value);
      return;
    }
    text.insert(0, " ");
    text.delete(0, 1);
  });
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}
