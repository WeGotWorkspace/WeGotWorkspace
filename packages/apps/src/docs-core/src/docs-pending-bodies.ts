import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { buildDocsCollabUrls } from "@/docs-core/src/docs-collab-urls";
import { listAllCachedDriveEntryPaths } from "@/lib/offline/drive/drive-directory-offline-store";
import { type PendingCollabRoom, uploadPendingCollabRooms } from "@/text-editor-core/docs-collab";
import { isFileNodeId } from "@/lib/files/file-node-id";
import {
  DOCS_COLLAB_IDENTITY_DB_VERSION,
  docsCollabReadNames,
  docsCollabRoomKey,
  listExistingIndexedDatabaseNames,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { collabDocumentFormat } from "@/text-editor-core/docs-collab/docs-collab-utils";

/** Save document bodies typed offline in documents that are no longer open. */
export async function uploadPendingDocBodies(username: string): Promise<void> {
  // One listing for every file: only rooms that have a database are probed.
  const existing = await listExistingIndexedDatabaseNames();
  // No listing (older browsers): every candidate name would be opened, and
  // created, per file. Skip the sweep; the editor saves a room when opened.
  if (!existing) return;
  const rooms: PendingCollabRoom[] = [];
  for (const path of await listAllCachedDriveEntryPaths(username)) {
    const room = docsCollabRoomKey(path);
    if (!room || !isDocsCollabEditablePath(room)) continue;
    for (const databaseName of await docsCollabReadNames(room, existing)) {
      rooms.push({
        room,
        databaseName,
        urls: () => buildDocsCollabUrls(path, nodeIdOfDatabase(databaseName)),
        format: collabDocumentFormat(room),
      });
    }
  }
  await uploadPendingCollabRooms(rooms);
}

/** An id-keyed database names its FileNode: the save is refused if it moved. */
function nodeIdOfDatabase(databaseName: string): string | undefined {
  const suffix = `:${DOCS_COLLAB_IDENTITY_DB_VERSION}`;
  if (!databaseName.endsWith(suffix)) return undefined;
  const id = databaseName.slice(0, -suffix.length);
  return isFileNodeId(id) ? id : undefined;
}
