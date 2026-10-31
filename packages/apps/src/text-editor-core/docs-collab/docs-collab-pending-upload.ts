import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { withCrossTabLockIfFree } from "@/lib/offline/core/cross-tab-lock";
import { collabDatabaseHasPendingSave } from "@/lib/offline/core/offline-wipe";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
import { rememberSidecarEtag } from "./docs-collab-etag";
import { setCollabRoomPendingServerSave } from "./docs-collab-pending-registry";
import { persistCollabSave } from "./docs-collab-save-attempt";
import { fetchYjsSnapshot } from "./docs-collab-server-io";
import { setDocsCollabSyncState } from "./docs-collab-sync-registry";
import type { DocsCollabUrls } from "./docs-collab-types";
import { isArchivedRefusal, SERVER_ORIGIN } from "./docs-collab-utils";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

/** The lock an open editor holds for its room, and a background save tries. */
export function collabUploadLockName(databaseName: string): string {
  return `wgw-collab-upload:${databaseName}`;
}

export type PendingCollabRoom = {
  room: string;
  /** The y-indexeddb database that holds the body. */
  databaseName: string;
  /** Built only for a room that has something to save. */
  urls: () => DocsCollabUrls | Promise<DocsCollabUrls>;
  format: TextEditorContentFormat;
};

/**
 * Save bodies typed offline in a note or document the person has since left.
 * Without this they waited until that note or document was opened again.
 *
 * Each room merges the server snapshot first and saves with its entity tag,
 * the same save the editor runs. Anything a person must decide (text changed
 * outside the app, a conflict that survives one remerge) keeps the room
 * marked unsaved: the editor shows it when the room is opened. Rooms open in
 * this tab are skipped, their editor saves them.
 */
export async function uploadPendingCollabRooms(rooms: readonly PendingCollabRoom[]): Promise<void> {
  for (const room of rooms) {
    try {
      await uploadPendingCollabRoom(room);
    } catch (error) {
      console.warn("[docs-collab] background save failed", { room: room.room, error });
    }
  }
}

async function uploadPendingCollabRoom({
  room,
  databaseName,
  urls: buildUrls,
  format,
}: PendingCollabRoom): Promise<void> {
  // An open editor holds this lock for as long as it has the room.
  await withCrossTabLockIfFree(collabUploadLockName(databaseName), async () => {
    if (!(await collabDatabaseHasPendingSave(databaseName))) return;
    const urls = await buildUrls();
    const authToken = urls.authToken ?? (await wgwEnsureFreshAccessToken()) ?? undefined;
    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(databaseName, ydoc);
    try {
      await persistence.whenSynced;
      const snapshot = await fetchYjsSnapshot(urls.yjsUrl, authToken);
      rememberSidecarEtag(room, snapshot.etag);
      if (snapshot.externalWrite) return;
      if (snapshot.update) Y.applyUpdate(ydoc, snapshot.update, SERVER_ORIGIN);

      const read = () => readContentFromYDoc(ydoc, format);
      const saved = await persistCollabSave({
        urls,
        room,
        ydoc,
        markdown: read(),
        authToken,
        remergeAttempted: { current: false },
        markdownAfterMerge: read,
      }).catch(async (error: unknown) => {
        if (!isArchivedRefusal(error)) throw error;
        // Archive wins (#1535): the edit is not retried. The app is told.
        urls.onPersistArchived?.();
        return { status: "archived" as const };
      });
      if (saved.status === "skipped") return;
      await persistence.del(PENDING_SERVER_SAVE_KEY);
      setCollabRoomPendingServerSave(room, false);
      setDocsCollabSyncState(room, { pendingServerSave: false, failedSync: false });
    } finally {
      await persistence.destroy();
      ydoc.destroy();
    }
  });
}
