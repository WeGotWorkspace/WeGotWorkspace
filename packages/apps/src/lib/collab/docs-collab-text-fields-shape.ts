import type * as Y from "yjs";
import { NOTE_TITLE_YTEXT_KEY } from "./docs-collab-document-title";

/**
 * Keys and detection for the text-fields document shape (#2208): a title and
 * a plain description, each a `Y.Text`. The seed, replacement and cleanup
 * live in `text-editor-core/docs-collab/docs-collab-text-fields.ts`; this
 * part sits in lib so `isYDocEmpty` can ask it without importing the editor.
 */
export const TEXT_FIELDS_TITLE = NOTE_TITLE_YTEXT_KEY;
export const TEXT_FIELDS_BODY = "plain-body";
/** `base`: what the document last took from the server. `seed`: the live seed's client id. */
export const TEXT_FIELDS_META = "text-fields-meta";
/** One key per seed client id ever applied; the cleanup deletes all but the live one. */
export const TEXT_FIELDS_SEEDS = "text-fields-seeds";

const textFieldsDocs = new WeakSet<Y.Doc>();

/** The session registers its document, so an empty one is known before it holds a field. */
export function markTextFieldsDoc(doc: Y.Doc): void {
  textFieldsDocs.add(doc);
}

/** A document of this shape: registered by its session, or recognisable by its types. */
export function isTextFieldsDoc(doc: Y.Doc): boolean {
  return (
    textFieldsDocs.has(doc) ||
    doc.share.has(TEXT_FIELDS_BODY) ||
    doc.share.has(TEXT_FIELDS_META) ||
    doc.share.has(TEXT_FIELDS_SEEDS)
  );
}

/** Empty: neither field exists. Reading never creates a shared type (no `default` fragment). */
export function isTextFieldsEmpty(doc: Y.Doc): boolean {
  return !doc.share.has(TEXT_FIELDS_TITLE) && !doc.share.has(TEXT_FIELDS_BODY);
}
