import { useCallback, type Dispatch, type SetStateAction } from "react";
import { Star, StarOff, Trash2 } from "lucide-react";
import { runQueuedBatchAction } from "@/hooks/use-batch-actions";
import { useAppToast } from "@/hooks/use-app-toast";
import { settleAll, type QueueMutation } from "@/hooks/use-queued-mutation";
import { runImmediateDriveBatch } from "@/drive-core/src/run-immediate-drive-batch";
import {
  driveRestoreMoves,
  restoreDriveStars,
  trashDriveRows,
} from "@/drive-core/src/drive-undo-writes";
import {
  refreshOpenFolderAfterBatch,
  useDriveMoveToFolder,
} from "@/drive-core/src/use-drive-move-to-folder";
import type { BeginOptimisticUpdateFn } from "@/hooks/use-entity-batch-actions";
import {
  reloadDriveFolderListing,
  restoreCompletedDriveMoves,
  restoredDriveNamesMessage,
  resolveDriveFileApiPath,
  unrestoredDriveFilesMessage,
  type DriveRestoreMove,
} from "@/drive-core/src/drive-batch-utils";
import { DRIVE_TRASH_UI_PATH, isForeignDriveApiPath } from "@/drive-core/src/drive-path-utils";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import {
  driveRowsById,
  patchAllFilesRows,
  type DriveAllFilesPatch,
} from "@/drive-core/src/use-drive-all-files";

async function finishDriveRestore(input: {
  operations: DriveAPIOperations;
  moves: readonly DriveRestoreMove[];
  completedKeys: ReadonlySet<string>;
  username: string;
  groupRoots: Set<string>;
  folderPath: string;
  setFiles: Dispatch<SetStateAction<DriveFile[]>>;
  show: (message: string) => void;
  showError: (message: string) => void;
  /** All Files: reload once the files are back. */
  reloadAllFiles?: () => void;
}): Promise<void> {
  try {
    const { restored, failures } = await restoreCompletedDriveMoves({
      operations: input.operations,
      moves: input.moves,
      completedKeys: input.completedKeys,
      username: input.username,
      groupRoots: input.groupRoots,
    });
    const restoredMessage = restoredDriveNamesMessage(restored);
    if (restoredMessage) input.show(restoredMessage);
    if (failures > 0) input.showError(unrestoredDriveFilesMessage(failures));
  } finally {
    await reloadDriveFolderListing(
      input.operations,
      input.folderPath,
      input.username,
      input.groupRoots,
      input.setFiles,
    );
    input.reloadAllFiles?.();
  }
}

type UseDriveBatchActionsArgs = {
  files: DriveFile[];
  setFiles: Dispatch<SetStateAction<DriveFile[]>>;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  selectionMode: boolean;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  activeId: string | null;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setDetailOpen: Dispatch<SetStateAction<boolean>>;
  starred: Record<string, boolean>;
  setStarred: Dispatch<SetStateAction<Record<string, boolean>>>;
  currentUsername: string;
  groupRootNames: Set<string>;
  operations?: DriveAPIOperations;
  queueMutation: QueueMutation;
  beginOptimisticUpdate: BeginOptimisticUpdateFn<DriveFile>;
  reloadStarredFromServer: () => void;
  view: ViewKey;
  /** Finds a row in any view, including All Files, Shared with me and Starred. */
  fileById: (id: string) => DriveFile | null;
  /** All Files keeps its own rows: a write shows there at once, then they reload. */
  allFiles?: { patchAllFiles?: DriveAllFilesPatch; reloadAllFiles?: () => void };
};

export function useDriveBatchActions({
  files,
  setFiles,
  selectedIds,
  setSelectedIds,
  selectionMode: _selectionMode,
  setSelectionMode,
  activeId,
  setActiveId,
  setDetailOpen,
  starred,
  setStarred,
  currentUsername,
  groupRootNames,
  operations,
  queueMutation,
  beginOptimisticUpdate,
  reloadStarredFromServer,
  view,
  fileById,
  allFiles,
}: UseDriveBatchActionsArgs) {
  const viewType = view.type;
  const patchAllFiles = allFiles?.patchAllFiles;
  const reloadAllFiles = allFiles?.reloadAllFiles;
  const { show, showError } = useAppToast();
  const clearSelectionForIds = useCallback(
    (ids: string[]) => {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      setSelectionMode(false);
      if (activeId && ids.includes(activeId)) {
        setActiveId(null);
        setDetailOpen(false);
      }
    },
    [activeId, setActiveId, setDetailOpen, setSelectedIds, setSelectionMode],
  );

  // After a write: the open folder, or All Files, shows what the server now holds.
  const refreshOpenFolder = useCallback(
    async (signal?: AbortSignal) => {
      if (view.type === "all") reloadAllFiles?.();
      if (!operations || view.type !== "folder") return;
      await reloadDriveFolderListing(
        operations,
        view.path,
        currentUsername,
        groupRootNames,
        setFiles,
        signal,
      );
    },
    [currentUsername, groupRootNames, operations, reloadAllFiles, setFiles, view],
  );

  const restoreMoves = useCallback(
    async (completedKeys: ReadonlySet<string>, moves: readonly DriveRestoreMove[]) => {
      if (!operations) return;
      await finishDriveRestore({
        operations,
        moves,
        completedKeys,
        username: currentUsername,
        groupRoots: groupRootNames,
        folderPath: view.type === "folder" ? view.path : "My Drive",
        setFiles,
        show,
        showError,
        reloadAllFiles: view.type === "all" ? reloadAllFiles : undefined,
      });
    },
    [currentUsername, groupRootNames, operations, reloadAllFiles, setFiles, show, showError, view],
  );

  const moveToTrash = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = driveRowsById(ids, fileById);
      if (rows.length === 0) return;

      const isForeign = (file: DriveFile) =>
        isForeignDriveApiPath(
          resolveDriveFileApiPath(file, currentUsername, groupRootNames),
          currentUsername,
          groupRootNames,
        );
      const ownRows = rows.filter((file) => !isForeign(file));
      const foreignRows = rows.filter(isForeign);
      const previousFiles = files;
      const previousSelectedIds = selectedIds;
      const trashedNameById = new Map<string, string>();

      setFiles((prev) =>
        prev.map((file) =>
          ids.includes(file.id) ? { ...file, parent: DRIVE_TRASH_UI_PATH } : file,
        ),
      );
      const restoreAll = patchAllFilesRows(view, patchAllFiles, reloadAllFiles, (all) =>
        all.filter((file) => !ids.includes(file.id)),
      );
      clearSelectionForIds(ids);

      const run = async (stop: AbortSignal, markCompleted: (id: string) => void) => {
        if (!operations) return;
        await trashDriveRows(
          { operations, username: currentUsername, groupRoots: groupRootNames },
          {
            ownRows,
            foreignRows,
            trashedNameById,
            stop,
            markCompleted,
          },
        );
        await refreshOpenFolderAfterBatch(refreshOpenFolder, stop);
      };
      const batch = {
        queueMutation,
        key: `drive:trash:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} to Trash`,
        icon: <Trash2 className="size-4" />,
        undoToastMessage: "Move to trash undone.",
        rollback: () => {
          restoreAll();
          setFiles(previousFiles);
          setSelectedIds(previousSelectedIds);
          if (previousSelectedIds.length > 0) setSelectionMode(true);
        },
      };
      // Items shared with you are deleted, not trashed: that cannot be taken back, so a
      // batch with any of them waits for the grace period and Undo cancels all of it.
      if (foreignRows.length > 0) {
        runQueuedBatchAction({
          ...batch,
          irreversible: true,
          execute: (signal) => run(signal, () => undefined),
        });
        return;
      }
      runImmediateDriveBatch({
        ...batch,
        execute: run,
        revert: (completedKeys) =>
          restoreMoves(
            completedKeys,
            driveRestoreMoves(
              rows,
              DRIVE_TRASH_UI_PATH,
              currentUsername,
              groupRootNames,
              trashedNameById,
            ),
          ),
      });
    },
    [
      clearSelectionForIds,
      currentUsername,
      fileById,
      files,
      groupRootNames,
      operations,
      patchAllFiles,
      queueMutation,
      refreshOpenFolder,
      reloadAllFiles,
      restoreMoves,
      selectedIds,
      setFiles,
      setSelectedIds,
      setSelectionMode,
      view,
    ],
  );

  const reallyDelete = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = driveRowsById(ids, fileById);
      if (rows.length === 0) return;

      const previousFiles = files;
      const previousSelectedIds = selectedIds;

      setFiles((prev) => prev.filter((file) => !ids.includes(file.id)));
      const restoreAll = patchAllFilesRows(view, patchAllFiles, reloadAllFiles, (all) =>
        all.filter((file) => !ids.includes(file.id)),
      );
      clearSelectionForIds(ids);

      // A permanent delete cannot be taken back: it waits, and Undo cancels it.
      runQueuedBatchAction({
        queueMutation,
        irreversible: true,
        key: `drive:delete:${ids.slice().sort().join(",")}`,
        toastMessage: `Deleted ${ids.length} file${ids.length === 1 ? "" : "s"}`,
        icon: <Trash2 className="size-4" />,
        undoToastMessage: "Deletion undone.",
        rollback: () => {
          restoreAll();
          setFiles(previousFiles);
          setSelectedIds(previousSelectedIds);
          if (previousSelectedIds.length > 0) setSelectionMode(true);
        },
        execute: async (signal) => {
          if (!operations) return;
          const paths = rows.map((file) =>
            resolveDriveFileApiPath(file, currentUsername, groupRootNames),
          );
          await operations.deleteItems(paths, { signal });
          await refreshOpenFolderAfterBatch(refreshOpenFolder, signal);
        },
      });
    },
    [
      clearSelectionForIds,
      currentUsername,
      fileById,
      files,
      groupRootNames,
      operations,
      patchAllFiles,
      queueMutation,
      refreshOpenFolder,
      reloadAllFiles,
      selectedIds,
      setFiles,
      setSelectedIds,
      setSelectionMode,
      view,
    ],
  );

  const batchStar = useCallback(() => {
    if (selectedIds.length === 0) return;
    const rows = selectedIds.flatMap((id) => fileById(id) ?? []);
    if (rows.length === 0) return;

    const nextValue = !selectedIds.every((id) => starred[id]);
    const previousStarred = { ...starred };
    const starChanges = rows
      .filter((file) => !!starred[file.id] !== nextValue)
      .map((file) => ({
        path: resolveDriveFileApiPath(file, currentUsername, groupRootNames),
        before: !nextValue,
      }));
    const toastIcon = nextValue ? (
      <Star className="size-4" fill="currentColor" />
    ) : (
      <StarOff className="size-4" />
    );

    setStarred((state) => {
      const next = { ...state };
      selectedIds.forEach((id) => {
        next[id] = nextValue;
      });
      return next;
    });

    runQueuedBatchAction({
      queueMutation,
      key: `drive:batch-star:${selectedIds.slice().sort().join(",")}`,
      toastMessage: `${nextValue ? "Starred" : "Unstarred"} ${selectedIds.length}`,
      icon: toastIcon,
      execute: async (signal, markCompleted) => {
        if (!operations) return;
        await settleAll(
          rows.map(async (file) => {
            const path = resolveDriveFileApiPath(file, currentUsername, groupRootNames);
            await operations.setStar({ path, starred: nextValue }, { signal });
            markCompleted(path);
          }),
        );
        reloadStarredFromServer(); // Starred spans folders: refresh from any view.
      },
      revert: async (completedKeys) => {
        if (!operations) return;
        await restoreDriveStars(
          operations,
          starChanges.filter(({ path }) => !completedKeys || completedKeys.has(path)),
        );
        if (viewType === "starred") reloadStarredFromServer();
      },
      rollback: () => {
        setStarred(previousStarred);
        if (viewType === "starred") reloadStarredFromServer();
      },
      undoToastMessage: "Star changes undone.",
    });
  }, [
    currentUsername,
    fileById,
    groupRootNames,
    operations,
    queueMutation,
    reloadStarredFromServer,
    selectedIds,
    setStarred,
    starred,
    viewType,
  ]);

  const moveToFolder = useDriveMoveToFolder({
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
  });

  return { moveToTrash, reallyDelete, batchStar, moveToFolder };
}
