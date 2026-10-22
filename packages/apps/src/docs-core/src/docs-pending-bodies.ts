import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { buildDocsCollabUrls } from "@/docs-core/src/docs-collab-urls";
import { listAllCachedDriveEntryPaths } from "@/lib/offline/drive/drive-directory-offline-store";
import { type PendingCollabRoom, uploadPendingCollabRooms } from "@/text-editor-core/docs-collab";
import {
  docsCollabReadNames,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { collabDocumentFormat } from "@/text-editor-core/docs-collab/docs-collab-utils";

/** Save document bodies typed offline in documents that are no longer open. */
export async function uploadPendingDocBodies(username: string): Promise<void> {
  const rooms: PendingCollabRoom[] = [];
  for (const path of await listAllCachedDriveEntryPaths(username)) {
    const room = docsCollabRoomKey(path);
    if (!room || !isDocsCollabEditablePath(room)) continue;
    for (const databaseName of await docsCollabReadNames(room)) {
      rooms.push({
        room,
        databaseName,
        urls: () => buildDocsCollabUrls(path),
        format: collabDocumentFormat(room),
      });
    }
  }
  await uploadPendingCollabRooms(rooms);
}
