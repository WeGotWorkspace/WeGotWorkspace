import type * as Y from "yjs";
import * as Yjs from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { adoptServerSnapshot } from "@/lib/collab/docs-collab-bootstrap";
import { writeNoteTitle } from "@/lib/collab/docs-collab-document-title";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";

export type ExternalWriteDetail = {
  markdown: string;
  title: string | null;
  /** The stale sidecar every client read; the rebuild replaces exactly that state. */
  serverState: Uint8Array;
};

/**
 * Origin of the rebuild transaction. Unlike the server origin it is published
 * to peers and other tabs: one that still holds the stale state and has not
 * read the server since follows the rebuild instead of keeping the old text.
 */
export const EXTERNAL_REBUILD_ORIGIN = "external-rebuild";

export type ExternalWriteAction = "adopt" | "rebuild" | "prompt";

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
 * markdown over the same state produces the same items, so a second client
 * rebuilding it merges instead of duplicating. The state is part of the seed
 * id: outside text equal to the first seed would otherwise map onto items the
 * person has since deleted, and the rebuild would leave the document empty.
 * It is the server sidecar's state vector, never the local one: local edits
 * and IndexedDB history differ per client and would seed different items.
 *
 * The server state is applied first, so the deletes cover everything a peer
 * may still hold. A quiet rebuild deletes only that history: an item a peer
 * typed after it stays, and the rebuild is safe to publish. `dropLocalWork`
 * is the person's own choice in the prompt and deletes every other item too.
 */
export function replaceDocumentWithExternalText(
  ydoc: Y.Doc,
  markdown: string,
  title: string | null,
  format: TextEditorContentFormat,
  serverState: Uint8Array,
  { dropLocalWork = false }: { dropLocalWork?: boolean } = {},
): void {
  if (!isReadableYjsUpdate(serverState)) {
    reseedOverUnreadableState(ydoc, markdown, title, format, serverState);
    return;
  }
  Yjs.applyUpdate(ydoc, serverState, SERVER_ORIGIN);
  const serverStateVector = Yjs.encodeStateVectorFromUpdate(serverState);
  const seeded = new Yjs.Doc();
  applyContentSeedToYDoc(seeded, markdown, format, serverStateVector.join(","));
  if (title !== null) writeNoteTitle(seeded, title);
  adoptServerSnapshot(
    ydoc,
    Yjs.encodeStateAsUpdate(seeded),
    EXTERNAL_REBUILD_ORIGIN,
    dropLocalWork ? undefined : Yjs.decodeStateVector(serverStateVector),
  );
  seeded.destroy();
}

/**
 * Bytes a client can apply in full: they decode, and no struct waits for a
 * parent the bytes never deliver. The server stores a writer's state without
 * reading it (#2208), so a stored state can be neither.
 */
export function isReadableYjsUpdate(update: Uint8Array): boolean {
  const scratch = new Yjs.Doc();
  try {
    Yjs.applyUpdate(scratch, update);
    return scratch.store.pendingStructs === null && scratch.store.pendingDs === null;
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
}

/**
 * The rebuild for a stored state no client can read: nothing of it is
 * applied, every item the document holds is deleted (as with the person's
 * own "use the other version"), and the outside text is seeded. The seed id
 * comes from the unreadable bytes, so every client that reads them seeds the
 * same items, and they never match an earlier seed of the same text.
 */
function reseedOverUnreadableState(
  ydoc: Y.Doc,
  markdown: string,
  title: string | null,
  format: TextEditorContentFormat,
  serverState: Uint8Array,
): void {
  let hash = 0x811c9dc5;
  for (const byte of serverState) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  const seeded = new Yjs.Doc();
  applyContentSeedToYDoc(seeded, markdown, format, `unreadable:${serverState.length}:${hash}`);
  if (title !== null) writeNoteTitle(seeded, title);
  adoptServerSnapshot(ydoc, Yjs.encodeStateAsUpdate(seeded), EXTERNAL_REBUILD_ORIGIN);
  seeded.destroy();
}
