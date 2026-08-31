import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/use-docs-collab-save";
import {
  docsCollabRoomKey,
  migrateCollabPersistence,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { readContentFromYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { isYDocEmpty } from "@/text-editor-core/docs-collab/docs-collab-utils";

/** y-indexeddb room key = VJOURNAL UID (never a Drive `.notes` path). */
export function noteCollabRoomKey(uid: string): string {
  return docsCollabRoomKey(uid);
}

async function withRoom<T>(
  uid: string,
  run: (ydoc: Y.Doc, persistence: IndexeddbPersistence) => Promise<T>,
): Promise<T | undefined> {
  const room = noteCollabRoomKey(uid);
  if (!room) return undefined;
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(room, ydoc);
  try {
    await persistence.whenSynced;
    return await run(ydoc, persistence);
  } catch {
    return undefined;
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

/** Headlessly read markdown from the UID-keyed collab crash buffer. */
export async function readNoteCollabOfflineContent(uid: string): Promise<string | null> {
  const content = await withRoom(uid, async (ydoc) => {
    if (isYDocEmpty(ydoc)) return null;
    return readContentFromYDoc(ydoc, "markdown");
  });
  return content ?? null;
}

export async function hasNoteCollabOfflinePersistence(uid: string): Promise<boolean> {
  const found = await withRoom(uid, async (ydoc) => !isYDocEmpty(ydoc));
  return Boolean(found);
}

export async function hasNoteCollabPendingServerSave(uid: string): Promise<boolean> {
  const pending = await withRoom(uid, async (_ydoc, persistence) =>
    persistence.get(PENDING_SERVER_SAVE_KEY),
  );
  return Boolean(pending);
}

/** Move the UID-keyed crash buffer after an offline create remaps to a server UID. */
export async function migrateNoteCollabRoom(oldUid: string, newUid: string): Promise<void> {
  const from = noteCollabRoomKey(oldUid);
  const to = noteCollabRoomKey(newUid);
  if (!from || !to || from === to) return;
  const hasOld = await hasNoteCollabOfflinePersistence(oldUid);
  if (!hasOld) return;
  await migrateCollabPersistence(from, to);
}
