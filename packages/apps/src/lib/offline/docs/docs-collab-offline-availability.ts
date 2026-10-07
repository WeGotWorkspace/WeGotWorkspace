import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import {
  docsCollabIndexedDbKey,
  docsCollabLegacyIndexedDbKeys,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { isYDocEmpty } from "@/text-editor-core/docs-collab/docs-collab-utils";

async function roomHasCollabPersistence(roomKey: string): Promise<boolean> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(roomKey, ydoc);
  try {
    await persistence.whenSynced;
    return !isYDocEmpty(ydoc);
  } catch {
    return false;
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

/** Whether a collab room has local Yjs state restorable without network. */
export async function hasDocsCollabOfflinePersistence(
  apiPath: string | null | undefined,
): Promise<boolean> {
  const room = docsCollabRoomKey(apiPath ?? "");
  if (!room || !isDocsCollabEditablePath(room)) return false;

  if (await roomHasCollabPersistence(docsCollabIndexedDbKey(room))) return true;

  for (const legacyKey of docsCollabLegacyIndexedDbKeys(room)) {
    if (await roomHasCollabPersistence(legacyKey)) return true;
  }
  return false;
}
