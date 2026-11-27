import * as Y from "yjs";
import { collabShapeOf } from "@/lib/collab/collab-document-shape";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
import {
  isTextFieldsDoc,
  readTextFields,
  readTextFieldsBase,
  textFieldsContentTag,
  textFieldsMetaToken,
  writeTextFieldsBaseIfUnchanged,
} from "./docs-collab-text-fields";

/**
 * What a collab save sends, read from the document through its shape. A
 * text-fields document (#2208) is its own save body, with no editor getter;
 * Docs and Notes read the editor (or the override) as before.
 */
export type CollabSaveBody = {
  /** The body to send now. */
  markdown: string;
  /** The body as the document holds it at this moment. */
  current: () => string;
  /** The body after a 412 merge; without an editor getter, the body sent. */
  afterMerge: () => string;
  /** The tag a save with no stored state names: the text it started from. */
  seenFallback: () => string | null;
  /** A text-fields body: its save signature is taken when the request starts. */
  textFields: boolean;
  /** Typing landed while the save was on its way. */
  editedSince: (saved: string, latest: (() => string) | null) => boolean;
  /** Called before the request; records `base` once the save lands. */
  startSave: () => { landed: (saved: string) => Promise<void> } | null;
};

export function collabSaveBody(
  ydoc: Y.Doc | null,
  refs: {
    getMarkdownRef: { current: (() => string) | null };
    markdownOverrideRef: { current: string | null };
  },
  holdSave?: () => boolean,
): CollabSaveBody | null {
  if (!ydoc || holdSave?.()) return null;
  // A registered shape (Sheets spike: YCSV) is its own save body, like text-fields.
  const shape = collabShapeOf(ydoc);
  const getMd = shape ? () => shape.read(ydoc) : refs.getMarkdownRef.current;
  const override = refs.markdownOverrideRef.current;
  const textFields = isTextFieldsDoc(ydoc);
  if (!getMd && override === null && !textFields) return null;
  const current = () =>
    textFields
      ? readTextFields(ydoc).description
      : shape
        ? shape.read(ydoc)
        : markdownForSave(ydoc, getMd ? getMd() : "");
  const markdown = override ?? current();
  // The title the request carries; typing in it while the save is on its way is not in the body.
  const sentTitle = textFields ? readTextFields(ydoc).title : "";
  return {
    textFields,
    markdown,
    current,
    afterMerge: () => (getMd || textFields ? current() : markdown),
    seenFallback: () => (textFields ? (readTextFieldsBase(ydoc)?.contentTag ?? null) : null),
    editedSince: (saved, latest) => {
      if (textFields) return current() !== saved || readTextFields(ydoc).title !== sentTitle;
      if (shape) return shape.read(ydoc) !== saved;
      return latest ? markdownForSave(ydoc, latest()) !== saved : false;
    },
    startSave: () => (textFields ? textFieldsSaveBase(ydoc) : null),
  };
}

export function markdownForSave(ydoc: Y.Doc, editorMarkdown: string): string {
  try {
    const fromDoc = readContentFromYDoc(ydoc);
    if (
      editorMarkdown !== "" &&
      fromDoc.includes(editorMarkdown) &&
      fromDoc.length > editorMarkdown.length
    ) {
      return fromDoc;
    }
  } catch {
    // The editor string is still a valid save body.
  }
  return editorMarkdown;
}

/**
 * What a text-fields save records as `base` once it lands: the text and
 * vector as encoded now, written only if `text-fields-meta` did not change
 * meanwhile (a replacement or a peer's newer `base` wins).
 */
function textFieldsSaveBase(ydoc: Y.Doc): { landed: (savedDescription: string) => Promise<void> } {
  const token = textFieldsMetaToken(ydoc);
  const { title } = readTextFields(ydoc);
  const vector: Record<string, number> = {};
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(ydoc))) {
    vector[String(client)] = clock;
  }
  return {
    landed: async (description) => {
      const contentTag = await textFieldsContentTag({ title, description });
      writeTextFieldsBaseIfUnchanged(ydoc, token, { contentTag, title, description, vector });
    },
  };
}

/**
 * The save body a pending-flag signature is taken from: a text-fields
 * document's description, or the editor's markdown. Null when neither exists.
 */
export function pendingSignatureBody(
  ydoc: Y.Doc,
  getMarkdown: (() => string) | null,
): string | null {
  if (isTextFieldsDoc(ydoc)) return readTextFields(ydoc).description;
  const shape = collabShapeOf(ydoc);
  if (shape) return shape.read(ydoc);
  return getMarkdown ? getMarkdown() : null;
}
