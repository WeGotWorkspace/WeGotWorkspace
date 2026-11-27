import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { parentAndName } from "@/lib/files/api-path";
import {
  captureDocsTrashSnapshot,
  docsTrashSnapshotAt,
  restoreDocsTrashSnapshot,
  undoQueuedDocsTrash,
  type DocsTrashUndoSnapshot,
} from "@/lib/offline/docs/docs-trash-undo";
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
          snapshot: await captureDocsTrashSnapshot(offlineUsername, file.apiPath!),
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
  return docsTrashSnapshotAt(snapshot, destination === "/" ? `/${to}` : `${destination}/${to}`);
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
  const trashDirectory = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, input.username, input.groupRoots);
  try {
    // A trash still in the outbox never reached the server: undo it on this device.
    const queuedLocally = await undoQueuedLocalTrashes(input, trashDirectory);
    // Offline nothing else can have landed.
    if (!readBrowserOnline()) return;

    const serverCompleted = new Set(
      [...input.completedKeys].filter((id) => !queuedLocally.has(id)),
    );
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

    // The server rename moved the tree row back; the pin and local text follow it.
    if (input.offlineUsername) {
      for (const entry of input.offlineSnapshots) {
        const to = restoredToById.get(entry.id);
        if (!to) continue;
        try {
          await restoreDocsTrashSnapshot(
            input.offlineUsername,
            snapshotOnRestoredPath(entry.snapshot, to),
          );
        } catch (error) {
          console.error("Docs home trash undo failed", error);
        }
      }
    }
  } finally {
    input.reload();
    input.onAvailabilityChanged?.();
  }
}

/** Undo the trashes still queued on this device; returns their ids. */
async function undoQueuedLocalTrashes(
  input: {
    offlineUsername: string | null;
    offlineSnapshots: readonly DocsHomeTrashOfflineSnapshot[];
    completedKeys: ReadonlySet<string>;
    trashedNameById: ReadonlyMap<string, string>;
  },
  trashDirectory: string,
): Promise<Set<string>> {
  const queuedLocally = new Set<string>();
  if (!input.offlineUsername) return queuedLocally;
  for (const entry of input.offlineSnapshots) {
    if (!input.completedKeys.has(entry.id)) continue;
    const trashedName = input.trashedNameById.get(entry.id);
    if (!trashedName) continue;
    try {
      const undone = await undoQueuedDocsTrash(
        input.offlineUsername,
        entry.snapshot,
        normalizeApiVirtualPath(`${trashDirectory}/${trashedName}`),
      );
      if (undone) queuedLocally.add(entry.id);
    } catch (error) {
      console.error("Docs home trash undo failed", error);
    }
  }
  return queuedLocally;
}
