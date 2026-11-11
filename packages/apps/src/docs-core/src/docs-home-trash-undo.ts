import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { parentAndName } from "@/lib/files/api-path";
import {
  captureOfflineDocsTrashSnapshot,
  undoOfflineDocsTrash,
  type DocsTrashUndoSnapshot,
} from "@/lib/offline/docs/docs-hybrid-operations";
import { removeOutboxMutationsForDocsPath } from "@/lib/offline/docs/docs-outbox-flush";
import { renamedDocsSearchResult } from "@/lib/offline/docs-listing-offline-store";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import {
  restoreCompletedDriveMoves,
  restoredDriveNamesMessage,
  unrestoredDriveFilesMessage,
  type DriveRestoreMove,
} from "@/drive-core/src/drive-batch-utils";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  resolveFreeName,
} from "@/lib/files/drive-entry-names";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_UI_PATH,
  normalizeApiVirtualPath,
} from "@/lib/files/drive-path-utils";

export type DocsHomeTrashOfflineSnapshot = {
  id: string;
  snapshot: DocsTrashUndoSnapshot;
};

/**
 * Moves docs into Trash one at a time and marks each rename the server applied. Offline
 * cache snapshots are taken first and handed out before any rename, so Undo has them
 * even when a later rename fails. `stop` is only checked between files.
 */
export async function moveDocsRowsToTrash(
  operations: DriveAPIOperations,
  rows: readonly DriveFile[],
  target: {
    username: string;
    groupRoots: Set<string>;
    offlineUsername: string | null;
    stop: AbortSignal;
  },
  sink: {
    trashedNameById: Map<string, string>;
    markCompleted: (id: string) => void;
    onSnapshots: (snapshots: DocsHomeTrashOfflineSnapshot[]) => void;
  },
): Promise<void> {
  const { username, groupRoots, offlineUsername, stop } = target;
  if (offlineUsername) {
    sink.onSnapshots(
      await Promise.all(
        rows.map(async (file) => ({
          id: file.id,
          snapshot: await captureOfflineDocsTrashSnapshot(offlineUsername, file.apiPath!),
        })),
      ),
    );
  }
  await ensureTrashFolder(operations, username, groupRoots, stop);
  const destination = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, username, groupRoots);
  const trashNames = await listTrashEntryNames(operations, destination, stop);
  for (const file of rows) {
    stop.throwIfAborted();
    const to = resolveFreeName(file.title, trashNames);
    trashNames.add(to);
    sink.trashedNameById.set(file.id, to);
    // No signal: a cancelled rename may still land, and Undo must then move it back.
    await operations.renameItem({ destination, from: normalizeApiVirtualPath(file.apiPath!), to });
    sink.markCompleted(file.id);
  }
}

/** Point a captured trash snapshot at the path the server actually restored. */
function snapshotOnRestoredPath(
  snapshot: DocsTrashUndoSnapshot,
  to: string,
): DocsTrashUndoSnapshot {
  const { destination } = parentAndName(snapshot.apiPath);
  const apiPath = normalizeApiVirtualPath(destination === "/" ? `/${to}` : `${destination}/${to}`);
  const listingResult = renamedDocsSearchResult(snapshot.listingResult, apiPath);
  return {
    ...snapshot,
    apiPath,
    listingResult,
    availability: snapshot.availability
      ? { ...snapshot.availability, id: listingResult.sourceKey }
      : undefined,
  };
}

/**
 * Put completed trash moves back. A taken original title uses the next free name.
 * One restore error does not stop the rest, and the home list reloads either way.
 * Online, the server rename finishes before offline caches are written, and only
 * at the path that rename used. A trash still sitting in the outbox never reached
 * the server: that entry is dropped and the original snapshot is restored.
 */
export async function revertDocsHomeTrash(input: {
  operations: DriveAPIOperations;
  rows: readonly DriveFile[];
  trashedNameById: ReadonlyMap<string, string>;
  completedKeys: ReadonlySet<string>;
  username: string;
  groupRoots: Set<string>;
  offlineUsername: string | null;
  offlineSnapshots: readonly DocsHomeTrashOfflineSnapshot[];
  show: (message: string) => void;
  showError: (message: string) => void;
  reload: () => void;
  onAvailabilityChanged?: () => void;
}): Promise<void> {
  try {
    // Offline trash never reached the server. Local cache undo is enough.
    if (!readBrowserOnline()) {
      await undoCompletedOfflineSnapshots(input, (snapshot) => snapshot);
      return;
    }

    const queuedLocally = await takeQueuedLocalTrashes(input);
    await undoCompletedOfflineSnapshots(input, (snapshot, id) =>
      queuedLocally.has(id) ? snapshot : undefined,
    );

    const serverCompleted = new Set(
      [...input.completedKeys].filter((id) => !queuedLocally.has(id)),
    );
    const trashDirectory = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, input.username, input.groupRoots);
    const moves: DriveRestoreMove[] = [];
    for (const file of input.rows) {
      if (!serverCompleted.has(file.id)) continue;
      const trashedName = input.trashedNameById.get(file.id);
      if (!trashedName) continue;
      moves.push({
        id: file.id,
        title: file.title,
        previousParent: file.parent,
        from: normalizeApiVirtualPath(`${trashDirectory}/${trashedName}`),
      });
    }
    const { restored, failures, restoredToById } = await restoreCompletedDriveMoves({
      operations: input.operations,
      moves,
      completedKeys: serverCompleted,
      username: input.username,
      groupRoots: input.groupRoots,
    });
    const restoredMessage = restoredDriveNamesMessage(restored);
    if (restoredMessage) input.show(restoredMessage);
    if (failures > 0) input.showError(unrestoredDriveFilesMessage(failures));

    await undoCompletedOfflineSnapshots(input, (snapshot, id) => {
      const to = restoredToById.get(id);
      return to ? snapshotOnRestoredPath(snapshot, to) : undefined;
    });
  } finally {
    input.reload();
    input.onAvailabilityChanged?.();
  }
}

/** Ids whose trash was still queued, so the file never reached the server. */
async function takeQueuedLocalTrashes(input: {
  offlineUsername: string | null;
  offlineSnapshots: readonly DocsHomeTrashOfflineSnapshot[];
  completedKeys: ReadonlySet<string>;
}): Promise<Set<string>> {
  const queuedLocally = new Set<string>();
  if (!input.offlineUsername) return queuedLocally;
  for (const entry of input.offlineSnapshots) {
    if (!input.completedKeys.has(entry.id)) continue;
    try {
      const removedTrash = await removeOutboxMutationsForDocsPath(
        input.offlineUsername,
        entry.snapshot.apiPath,
      );
      if (removedTrash) queuedLocally.add(entry.id);
    } catch (error) {
      console.error("Docs home trash undo failed", error);
    }
  }
  return queuedLocally;
}

async function undoCompletedOfflineSnapshots(
  input: {
    offlineUsername: string | null;
    offlineSnapshots: readonly DocsHomeTrashOfflineSnapshot[];
    completedKeys: ReadonlySet<string>;
  },
  rebase: (snapshot: DocsTrashUndoSnapshot, id: string) => DocsTrashUndoSnapshot | undefined,
): Promise<void> {
  if (!input.offlineUsername) return;
  for (const entry of input.offlineSnapshots) {
    if (!input.completedKeys.has(entry.id)) continue;
    const snapshot = rebase(entry.snapshot, entry.id);
    if (!snapshot) continue;
    try {
      await undoOfflineDocsTrash(input.offlineUsername, snapshot);
    } catch (error) {
      console.error("Docs home trash undo failed", error);
    }
  }
}
