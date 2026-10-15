import type * as Y from "yjs";
import * as Yjs from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { adoptServerSnapshot } from "./docs-collab-bootstrap";
import { writeNoteTitle } from "./docs-collab-document-title";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { SERVER_ORIGIN } from "./docs-collab-utils";

/** Set on `GET ?format=yjs` when the stored state is not an ancestor of the journal. */
export const EXTERNAL_WRITE_HEADER = "X-Wgw-External-Write";

export type ExternalWriteDetail = {
  markdown: string;
  title: string | null;
};

export type ExternalWriteAction = "adopt" | "rebuild" | "prompt";

export function externalWriteFromHeader(headers: Headers): boolean {
  return headers.get(EXTERNAL_WRITE_HEADER) === "1";
}

/**
 * A person is asked only when the server state has no CRDT ancestor and this
 * client still has unsaved work. With a clean document the note is rebuilt
 * from the text the outside writer left, and later edits merge again.
 */
export function decideExternalWrite(
  externalWrite: boolean,
  pendingLocalWork: boolean,
): ExternalWriteAction {
  if (!externalWrite) return "adopt";
  return pendingLocalWork ? "prompt" : "rebuild";
}

/**
 * Drop the stale CRDT and seed a new one from the outside text. The same
 * markdown produces the same items, so a second client rebuilding it merges
 * instead of duplicating.
 */
export function replaceDocumentWithExternalText(
  ydoc: Y.Doc,
  markdown: string,
  title: string | null,
  format: TextEditorContentFormat,
): void {
  const seeded = new Yjs.Doc();
  applyContentSeedToYDoc(seeded, markdown, format);
  if (title !== null) writeNoteTitle(seeded, title);
  adoptServerSnapshot(ydoc, Yjs.encodeStateAsUpdate(seeded), SERVER_ORIGIN);
  seeded.destroy();
}
