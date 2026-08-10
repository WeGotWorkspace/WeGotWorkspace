import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { docsCollabRoomKey } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { readContentFromYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import {
  collabDocumentFormat,
  isYDocEmpty,
} from "@/text-editor-core/docs-collab/docs-collab-utils";

async function readCollabRoomContent(roomKey: string, apiPath: string): Promise<string | null> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(roomKey, ydoc);
  try {
    await persistence.whenSynced;
    if (isYDocEmpty(ydoc)) return null;
    const format = collabDocumentFormat(apiPath);
    return readContentFromYDoc(ydoc, format);
  } catch {
    return null;
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

/**
 * Headlessly read markdown/text from a collab y-indexeddb room (no TipTap UI).
 * Tries the normalized room key, then a legacy leading-slash key.
 */
export async function readCollabOfflineContent(apiPath: string): Promise<string | null> {
  const room = docsCollabRoomKey(apiPath);
  if (!room || !isDocsCollabEditablePath(room)) return null;

  const content = await readCollabRoomContent(room, apiPath);
  if (content != null) return content;

  const legacy = apiPath.trim().startsWith("/") ? room : `/${room}`;
  if (legacy !== room) {
    return readCollabRoomContent(legacy, apiPath);
  }
  return null;
}
