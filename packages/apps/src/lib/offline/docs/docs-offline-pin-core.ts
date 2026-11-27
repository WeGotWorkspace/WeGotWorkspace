import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import {
  markDocsAvailabilitySynced,
  normalizeDocsAvailabilityPath,
  readDocsAvailability,
  removeDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { parentAndName } from "@/lib/files/api-path";
import { queueDocsOutbox } from "@/lib/offline/docs/docs-sync-runner";
import {
  hydrateDocsCollabForOffline,
  seedEmptyDocsCollabOffline,
} from "@/lib/offline/docs/docs-pin-hydrate";
import { clearDocsCollabOfflinePersistence } from "@/lib/collab/docs-collab-persistence";
import {
  readCachedDriveNodeId,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";

export type MakeDocsOfflineAvailableOptions = {
  /** Background sync paces every request through this. */
  beforeRequest?: () => Promise<void>;
  /**
   * When the file last changed, in ms. If the document was synced after that
   * and its local copy is not empty, nothing is fetched. Background sync only.
   */
  modifiedAtMs?: number;
};

export async function makeDocsOfflineAvailable(
  username: string,
  apiPath: string,
  location: string,
  options: MakeDocsOfflineAvailableOptions = {},
): Promise<void> {
  const room = apiPath.trim().replace(/^\/+/, "");
  if (!isDocsCollabEditablePath(room)) {
    throw new Error("Only editable text files can be made available offline.");
  }
  const { beforeRequest, modifiedAtMs } = options;
  const lastSyncedAt =
    modifiedAtMs === undefined
      ? null
      : ((await readDocsAvailability(username, room))?.lastSyncedAt ?? null);
  await hydrateDocsCollabForOffline({
    apiPath: room,
    beforeRequest,
    keepLocalCopy:
      modifiedAtMs !== undefined && lastSyncedAt !== null && lastSyncedAt >= modifiedAtMs,
  });
  const nodeId = await readCachedDriveNodeId(username, room);
  await writeDocsAvailability(username, { id: room, location, nodeId });
  await markDocsAvailabilitySynced(username, room);
}

export async function removeDocsOfflineCopy(username: string, apiPath: string): Promise<void> {
  const room = apiPath.trim().replace(/^\/+/, "");
  await clearDocsCollabOfflinePersistence(room);
  await removeDocsAvailability(username, room);
}

/** Queue a new empty document for offline create and seed local collab state. */
export async function queueNewDocsOfflineDocument(
  username: string,
  apiPath: string,
  location = "",
): Promise<void> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalizeDocsAvailabilityPath(normalized);
  await queueDocsOutbox(username, { op: "create", apiPath: normalized, content: "" });
  // Docs home lists the tree: the new Doc is a row there until the server's
  // FileNode replaces it (the tree prune keeps a queued create's path).
  await upsertDriveEntry(username, {
    type: "file",
    path: normalized,
    name: parentAndName(normalized).from,
    size: 0,
    time: Math.floor(Date.now() / 1000),
    permissions: 0,
    // The person creates it in a folder they write to: theirs to edit and share.
    myRights: {
      mayView: true,
      mayComment: true,
      mayReview: true,
      mayEditContent: true,
      mayManageStructure: true,
      mayShare: true,
    },
  });
  if (isDocsCollabEditablePath(room)) {
    await seedEmptyDocsCollabOffline(room);
    await writeDocsAvailability(username, { id: room, location });
    await markDocsAvailabilitySynced(username, room);
  }
}
