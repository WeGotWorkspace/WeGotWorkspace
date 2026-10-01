import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  undoOfflineDocsTrash,
  type DocsTrashUndoSnapshot,
} from "@/lib/offline/docs/docs-hybrid-operations";
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

/**
 * Put completed trash moves back. A taken original title uses the next free name.
 * One restore error does not stop the rest, and the home list reloads either way.
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
    if (input.offlineUsername) {
      for (const entry of input.offlineSnapshots) {
        if (!input.completedKeys.has(entry.id)) continue;
        try {
          await undoOfflineDocsTrash(input.offlineUsername, entry.snapshot);
        } catch (error) {
          console.error("Docs home trash undo failed", error);
        }
      }
    }
    // Offline trash never reached the server. Local cache undo above is enough.
    if (!readBrowserOnline()) return;

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
    const { restored, failures } = await restoreCompletedDriveMoves({
      operations: input.operations,
      moves,
      completedKeys: input.completedKeys,
      username: input.username,
      groupRoots: input.groupRoots,
    });
    const restoredMessage = restoredDriveNamesMessage(restored);
    if (restoredMessage) input.show(restoredMessage);
    if (failures > 0) input.showError(unrestoredDriveFilesMessage(failures));
  } finally {
    input.reload();
    input.onAvailabilityChanged?.();
  }
}
