import { parentAndName } from "@/lib/files/api-path";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import {
  captureDocsCollabOfflinePersistence,
  restoreDocsCollabOfflinePersistence,
  type DocsCollabOfflinePersistenceSnapshot,
} from "@/lib/collab/docs-collab-persistence";
import {
  readDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { removeOutboxMutationsForDocsPath } from "@/lib/offline/docs/docs-outbox-flush";
import type { OfflineDocsAvailabilityRow } from "@/lib/offline/docs/docs-schema";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";

/**
 * What a trash clears on this device that its undo puts back (#2063 C4): the
 * pin and the local collab text. The file's row and stored body are not in
 * the snapshot: a queued trash moves them into Trash in `drive_entries`, and
 * the undo moves them back.
 */
export type DocsTrashUndoSnapshot = {
  apiPath: string;
  availability?: OfflineDocsAvailabilityRow;
  collabPersistence?: DocsCollabOfflinePersistenceSnapshot;
};

/** Capture the pin and local text of a Doc before it is trashed. */
export async function captureDocsTrashSnapshot(
  username: string,
  apiPath: string,
): Promise<DocsTrashUndoSnapshot> {
  const normalized = normalizeApiVirtualPath(apiPath);
  return {
    apiPath: normalized,
    availability: await readDocsAvailability(username, normalized),
    collabPersistence: await captureDocsCollabOfflinePersistence(normalized),
  };
}

/** The same snapshot for the path a restore put the Doc at. */
export function docsTrashSnapshotAt(
  snapshot: DocsTrashUndoSnapshot,
  apiPath: string,
): DocsTrashUndoSnapshot {
  const normalized = normalizeApiVirtualPath(apiPath);
  return {
    ...snapshot,
    apiPath: normalized,
    availability: snapshot.availability
      ? { ...snapshot.availability, id: normalized.replace(/^\/+/, "") }
      : undefined,
  };
}

/** Put the pin and local text back at `snapshot.apiPath`. */
export async function restoreDocsTrashSnapshot(
  username: string,
  snapshot: DocsTrashUndoSnapshot,
): Promise<void> {
  if (snapshot.availability) await writeDocsAvailability(username, snapshot.availability);
  if (snapshot.collabPersistence) {
    await restoreDocsCollabOfflinePersistence(snapshot.apiPath, snapshot.collabPersistence);
  }
}

/**
 * Reverse a trash that never reached the server: drop its queued write, move
 * the tree row and stored body back out of Trash, and restore the snapshot.
 * Returns whether a queued trash was found; without one the caller restores
 * on the server instead.
 */
export async function undoQueuedDocsTrash(
  username: string,
  snapshot: DocsTrashUndoSnapshot,
  trashPath: string,
): Promise<boolean> {
  const removed = await removeOutboxMutationsForDocsPath(username, snapshot.apiPath);
  if (!removed) return false;
  const { destination, from: name } = parentAndName(snapshot.apiPath);
  // Page setup went back with the queued write.
  await applyDriveSidecarPathMigration(username, trashPath, destination, name, {
    movePageSetup: false,
  });
  await restoreDocsTrashSnapshot(username, snapshot);
  notifyDriveRemoteChange(username);
  return true;
}
