import type * as Y from "yjs";
import * as Yjs from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { adoptServerSnapshot } from "@/lib/collab/docs-collab-bootstrap";
import { writeNoteTitle } from "@/lib/collab/docs-collab-document-title";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { collabShapeOf } from "@/lib/collab/collab-document-shape";

/** The rebuild seed: through the document's registered shape (Sheets spike: YCSV), else the editor codec. */
function seedReplacement(
  ydoc: Yjs.Doc,
  seeded: Yjs.Doc,
  markdown: string,
  format: TextEditorContentFormat,
  salt: string,
): void {
  const shape = collabShapeOf(ydoc);
  if (shape) {
    shape.seed(seeded, markdown, { origin: SEED_ORIGIN, salt });
    return;
  }
  applyContentSeedToYDoc(seeded, markdown, format, salt);
}
import { seedClientId } from "./docs-collab-seed";
import { SEED_ORIGIN, SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";
import { isTextFieldsDoc } from "@/lib/collab/docs-collab-text-fields-shape";
import { replaceTextFields } from "./docs-collab-text-fields";

export type ExternalWriteDetail = {
  markdown: string;
  title: string | null;
  /** The stale sidecar every client read; the rebuild replaces exactly that state. */
  serverState: Uint8Array;
  /** Text-fields resources (#2208): the outside text's content tag and object version. */
  contentTag?: string | null;
  objectEtag?: string;
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
  {
    dropLocalWork = false,
    contentTag = null,
    objectEtag = "",
  }: { dropLocalWork?: boolean; contentTag?: string | null; objectEtag?: string } = {},
): void {
  if (isTextFieldsDoc(ydoc)) {
    // The text-fields replacement: a seed salted with the object version, a
    // delete limit that never covers a peer's unsaved typing (#2208).
    const readable = serverState.byteLength > 2 && isReadableYjsUpdate(serverState);
    replaceTextFields(
      ydoc,
      { title: title ?? "", description: markdown },
      {
        contentTag,
        objectEtag,
        storedState: readable ? serverState : null,
        dropOwnWork: dropLocalWork,
      },
    );
    return;
  }
  if (!isReadableYjsUpdate(serverState)) {
    reseedOverUnreadableState(ydoc, markdown, title, format, serverState);
    return;
  }
  Yjs.applyUpdate(ydoc, serverState, SERVER_ORIGIN);
  const serverStateVector = Yjs.encodeStateVectorFromUpdate(serverState);
  const seeded = new Yjs.Doc();
  const baseSalt = serverStateVector.join(",");
  // A quiet rebuild keeps the state-vector salt so peers merge. Dropping local
  // work deletes the seeded items again, so the salt moves on while this
  // document already holds either seed id (Yjs never recreates deleted items).
  const salt = dropLocalWork ? freeSalt(ydoc, markdown, title, format, baseSalt) : baseSalt;
  seedReplacement(ydoc, seeded, markdown, format, salt);
  writeSeedTitle(seeded, title, salt, markdown);
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
  // Seed ids are 32 bits: two unreadable payloads can share one. A seed whose
  // id the document already holds would map onto deleted items and leave the
  // text blank, so the salt moves on until the id is new to this document.
  const salt = freeSalt(ydoc, markdown, title, format, `unreadable:${serverState.length}:${hash}`);
  const seeded = new Yjs.Doc();
  seedReplacement(ydoc, seeded, markdown, format, salt);
  writeSeedTitle(seeded, title, salt, markdown);
  adoptServerSnapshot(ydoc, Yjs.encodeStateAsUpdate(seeded), EXTERNAL_REBUILD_ORIGIN);
  seeded.destroy();
}

function freeSalt(
  ydoc: Y.Doc,
  markdown: string,
  title: string | null,
  format: TextEditorContentFormat,
  base: string,
): string {
  const local = Yjs.decodeStateVector(Yjs.encodeStateVector(ydoc));
  const taken = (s: string): boolean =>
    local.has(seedClientId(format, markdown, s)) ||
    (title !== null && local.has(titleSeedId(title, s, markdown)));
  let salt = base;
  for (let n = 1; taken(salt); n += 1) salt = `${base}#${n}`;
  return salt;
}

/**
 * The title of a rebuild seed, written with a client id from the title and
 * the seed's salt: two clients rebuilding the same text write the same title
 * item, not one each (which would show the title twice).
 */
function titleSeedId(title: string, salt: string, markdown: string): number {
  // Keyed on the body too: the title seed collides only when the body seed does.
  return seedClientId("note-title", title, `${salt}\u0000${markdown}`);
}

function writeSeedTitle(seeded: Y.Doc, title: string | null, salt: string, markdown: string): void {
  if (title === null) return;
  seeded.clientID = titleSeedId(title, salt, markdown);
  writeNoteTitle(seeded, title);
}
