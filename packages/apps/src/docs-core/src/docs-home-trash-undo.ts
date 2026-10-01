import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { parentAndName } from "@/lib/files/api-path";
import {
  undoOfflineDocsTrash,
  type DocsTrashUndoSnapshot,
} from "@/lib/offline/docs/docs-hybrid-operations";
import { removeOutboxMutationsForDocsPath } from "@/lib/offline/docs/docs-outbox-flush";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import {
  restoreCompletedDriveMoves,
  restoredDriveNamesMessage,
  unrestoredDriveFilesMessage,
  type DriveRestoreMove,
} from "@/drive-core/src/drive-batch-utils";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_UI_PATH,
  normalizeApiVirtualPath,
} from "@/drive-core/src/drive-path-utils";

export type DocsHomeTrashOfflineSnapshot = {
  id: string;
  snapshot: DocsTrashUndoSnapshot;
};

/** Point a captured trash snapshot at the path the server actually restored. */
function snapshotOnRestoredPath(
  snapshot: DocsTrashUndoSnapshot,
  to: string,
): DocsTrashUndoSnapshot {
  const { destination } = parentAndName(snapshot.apiPath);
  const apiPath = normalizeApiVirtualPath(destination === "/" ? `/${to}` : `${destination}/${to}`);
  const sourceKey = apiPath.replace(/^\/+/, "");
  return {
    ...snapshot,
    apiPath,
    listingResult: {
      ...snapshot.listingResult,
      sourceKey,
      title: to,
    },
    availability: snapshot.availability ? { ...snapshot.availability, id: sourceKey } : undefined,
  };
}

/**
 * Put completed trash moves back. A taken original title uses the next free name.
 * One restore error does not stop the rest, and the home list reloads either way.
 * Online, the server rename finishes before offline caches are written, and only
 * at the path that rename used.
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

    await clearCompletedTrashOutbox(input);

    const trashDirectory = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, input.username, input.groupRoots);
    const moves: DriveRestoreMove[] = [];
    for (const file of input.rows) {
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
      completedKeys: input.completedKeys,
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

async function clearCompletedTrashOutbox(input: {
  offlineUsername: string | null;
  offlineSnapshots: readonly DocsHomeTrashOfflineSnapshot[];
  completedKeys: ReadonlySet<string>;
}): Promise<void> {
  if (!input.offlineUsername) return;
  for (const entry of input.offlineSnapshots) {
    if (!input.completedKeys.has(entry.id)) continue;
    try {
      await removeOutboxMutationsForDocsPath(input.offlineUsername, entry.snapshot.apiPath);
    } catch (error) {
      console.error("Docs home trash undo failed", error);
    }
  }
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
