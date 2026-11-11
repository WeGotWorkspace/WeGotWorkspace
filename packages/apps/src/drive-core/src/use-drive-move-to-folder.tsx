import { useCallback } from "react";
import { FolderInput } from "lucide-react";
import type { QueueMutation } from "@/hooks/use-queued-mutation";
import type { BeginOptimisticUpdateFn } from "@/hooks/use-entity-batch-actions";
import { runImmediateDriveBatch } from "@/drive-core/src/run-immediate-drive-batch";
import { driveRestoreMoves, moveDriveRows } from "@/drive-core/src/drive-undo-writes";
import { type DriveRestoreMove } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile, ViewKey } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import {
  driveRowsById,
  patchAllFilesRows,
  type DriveAllFilesPatch,
} from "@/drive-core/src/use-drive-all-files";

/** A failed folder reload is not a failed batch. The renames already reached the server. */
export async function refreshOpenFolderAfterBatch(
  refresh: (signal?: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  try {
    await refresh(signal);
  } catch (error) {
    console.error("Drive folder refresh failed", error);
  }
}

type UseDriveMoveToFolderArgs = {
  currentUsername: string;
  groupRootNames: Set<string>;
  operations?: DriveAPIOperations;
  queueMutation: QueueMutation;
  beginOptimisticUpdate: BeginOptimisticUpdateFn<DriveFile>;
  view: ViewKey;
  fileById: (id: string) => DriveFile | null;
  patchAllFiles?: DriveAllFilesPatch;
  reloadAllFiles?: () => void;
  /** Reloads the open folder (or All Files) after the write. */
  refreshOpenFolder: (signal?: AbortSignal) => Promise<void>;
  /** Undo after the server moved files: renames them back, then reloads. */
  restoreMoves: (
    completedKeys: ReadonlySet<string>,
    moves: readonly DriveRestoreMove[],
  ) => Promise<void>;
};

/** Moves rows from any view into `parent`: shown at once, renamed on the server, undoable. */
export function useDriveMoveToFolder({
  currentUsername,
  groupRootNames,
  operations,
  queueMutation,
  beginOptimisticUpdate,
  view,
  fileById,
  patchAllFiles,
  reloadAllFiles,
  refreshOpenFolder,
  restoreMoves,
}: UseDriveMoveToFolderArgs) {
  return useCallback(
    (ids: string[], parent: string) => {
      if (ids.length === 0) return;
      const rows = driveRowsById(ids, fileById);
      if (rows.length === 0) return;

      const { rollback: rollbackFiles } = beginOptimisticUpdate({
        ids,
        updater: (file) => ({ ...file, parent }),
      });
      const restoreAll = patchAllFilesRows(view, patchAllFiles, reloadAllFiles, (all) =>
        all.map((file) => (ids.includes(file.id) ? { ...file, parent } : file)),
      );
      const rollback = () => {
        rollbackFiles();
        restoreAll();
      };

      runImmediateDriveBatch({
        queueMutation,
        key: `drive:move:${parent}:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} to ${parent.split("/").pop()}`,
        icon: <FolderInput className="size-4" />,
        undoToastMessage: "Move undone.",
        rollback,
        execute: async (stop, markCompleted) => {
          if (!operations) return;
          await moveDriveRows(
            { operations, username: currentUsername, groupRoots: groupRootNames },
            rows,
            parent,
            stop,
            markCompleted,
          );
          await refreshOpenFolderAfterBatch(refreshOpenFolder, stop);
        },
        revert: (completedKeys) =>
          restoreMoves(
            completedKeys,
            driveRestoreMoves(rows, parent, currentUsername, groupRootNames),
          ),
      });
    },
    [
      beginOptimisticUpdate,
      currentUsername,
      fileById,
      groupRootNames,
      operations,
      patchAllFiles,
      queueMutation,
      refreshOpenFolder,
      reloadAllFiles,
      restoreMoves,
      view,
    ],
  );
}
