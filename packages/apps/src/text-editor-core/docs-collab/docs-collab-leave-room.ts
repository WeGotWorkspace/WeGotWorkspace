import type { IndexeddbPersistence } from "y-indexeddb";
import { getConnectivitySnapshot } from "@/lib/offline/browser-online";
import { setCollabRoomPendingServerSave } from "./docs-collab-pending-registry";
import { uploadPendingCollabRooms } from "./docs-collab-pending-upload";
import type { DocsCollabUrls } from "./docs-collab-types";
import { collabFormatForUrls } from "./docs-collab-utils";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

/** A room left while its save was still waiting on the save delay. */
export type CollabRoomLeftUnsaved = { room: string; urls: DocsCollabUrls };

/**
 * Closes a room's local store. A room left with a save still due (someone
 * typed and opened another note within the save delay) is marked unsaved and
 * saved by the background save, which merges the server copy first. Before,
 * that text stayed in this browser until the room was opened and edited again.
 */
export async function closeCollabRoomStore(
  persistence: IndexeddbPersistence,
  unsaved: CollabRoomLeftUnsaved | null,
): Promise<void> {
  if (!unsaved) {
    await persistence.destroy();
    return;
  }
  try {
    await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
    setCollabRoomPendingServerSave(unsaved.room, true);
  } finally {
    await persistence.destroy();
  }
  // Offline, the mark keeps it for the reconnect sweep.
  if (!getConnectivitySnapshot()) return;
  const { room, urls } = unsaved;
  await uploadPendingCollabRooms([
    {
      room,
      databaseName: persistence.name,
      // The room's token may be old by now; the save fetches a fresh one.
      urls: () => ({ ...urls, authToken: undefined }),
      format: collabFormatForUrls({ room, documentFormat: urls.documentFormat }),
    },
  ]);
}
