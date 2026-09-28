import { useCallback, type Dispatch, type SetStateAction } from "react";
import { FolderInput, Star, StarOff, Trash2 } from "lucide-react";
import { runQueuedBatchAction } from "@/hooks/use-batch-actions";
import { useAppToast } from "@/hooks/use-app-toast";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import { runImmediateDriveBatch } from "@/drive-core/src/run-immediate-drive-batch";
import type { BeginOptimisticUpdateFn } from "@/hooks/use-entity-batch-actions";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  reloadDriveFolderListing,
  restoreCompletedDriveMoves,
  restoredDriveNamesMessage,
  resolveDriveFileApiPath,
  resolveFreeName,
  unrestoredDriveFilesMessage,
  type DriveRestoreMove,
} from "@/drive-core/src/drive-batch-utils";
import { apiPathFromUiPath, DRIVE_TRASH_UI_PATH } from "@/drive-core/src/drive-path-utils";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

type QueueMutation = (args: DeferredApiWriteArgs) => void;

/** A failed folder reload is not a failed batch. The renames already reached the server. */
async function refreshOpenFolderAfterBatch(
  refresh: (signal?: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  try {
    await refresh(signal);
  } catch (error) {
    console.error("Drive folder refresh failed", error);
  }
}

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
  }
}

type MoveSnapshot = {
  file: DriveFile;
  previousParent: string;
};

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
  viewType: ViewKey["type"];
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
  viewType,
}: UseDriveBatchActionsArgs) {
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

  const refreshOpenFolder = useCallback(
    async (signal?: AbortSignal) => {
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
    [currentUsername, groupRootNames, operations, setFiles, view],
  );

  const moveToTrash = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = files.filter((file) => ids.includes(file.id));
      if (rows.length === 0) return;

      const snapshots: MoveSnapshot[] = rows.map((file) => ({
        file,
        previousParent: file.parent,
      }));
      const previousFiles = files;
      const previousSelectedIds = selectedIds;
      const trashedNameById = new Map<string, string>();

      setFiles((prev) =>
        prev.map((file) =>
          ids.includes(file.id) ? { ...file, parent: DRIVE_TRASH_UI_PATH } : file,
        ),
      );
      clearSelectionForIds(ids);

      runImmediateDriveBatch({
        queueMutation,
        key: `drive:trash:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} to Trash`,
        icon: <Trash2 className="size-4" />,
        undoToastMessage: "Move to trash undone.",
        rollback: () => {
          setFiles(previousFiles);
          setSelectedIds(previousSelectedIds);
          if (previousSelectedIds.length > 0) setSelectionMode(true);
        },
        execute: async (signal, markCompleted) => {
          if (!operations) return;
          await ensureTrashFolder(operations, currentUsername, groupRootNames, signal);
          const destination = apiPathFromUiPath(
            DRIVE_TRASH_UI_PATH,
            currentUsername,
            groupRootNames,
          );
          const trashNames = await listTrashEntryNames(operations, destination, signal);
          for (const file of rows) {
            const from = resolveDriveFileApiPath(file, currentUsername, groupRootNames);
            const to = resolveFreeName(file.title, trashNames);
            trashNames.add(to);
            trashedNameById.set(file.id, to);
            await operations.renameItem({ destination, from, to }, { signal });
            markCompleted(file.id);
          }
          await refreshOpenFolderAfterBatch(refreshOpenFolder, signal);
        },
        revert: async (completedKeys) => {
          if (!operations) return;
          await finishDriveRestore({
            operations,
            completedKeys,
            username: currentUsername,
            groupRoots: groupRootNames,
            folderPath: view.type === "folder" ? view.path : "My Drive",
            setFiles,
            show,
            showError,
            moves: snapshots.map(({ file, previousParent }) => ({
              id: file.id,
              title: file.title,
              previousParent,
              from: resolveDriveFileApiPath(
                {
                  ...file,
                  apiPath: undefined,
                  parent: DRIVE_TRASH_UI_PATH,
                  title: trashedNameById.get(file.id) ?? file.title,
                },
                currentUsername,
                groupRootNames,
              ),
            })),
          });
        },
      });
    },
    [
      clearSelectionForIds,
      currentUsername,
      files,
      groupRootNames,
      operations,
      queueMutation,
      refreshOpenFolder,
      selectedIds,
      setFiles,
      setSelectedIds,
      setSelectionMode,
      show,
      showError,
      view,
    ],
  );

  const reallyDelete = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = files.filter((file) => ids.includes(file.id));
      if (rows.length === 0) return;

      const previousFiles = files;
      const previousSelectedIds = selectedIds;

      setFiles((prev) => prev.filter((file) => !ids.includes(file.id)));
      clearSelectionForIds(ids);

      runImmediateDriveBatch({
        queueMutation,
        key: `drive:delete:${ids.slice().sort().join(",")}`,
        toastMessage: `Deleted ${ids.length} file${ids.length === 1 ? "" : "s"}`,
        icon: <Trash2 className="size-4" />,
        undoToastMessage: "Deletion undone.",
        rollback: () => {
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
      files,
      groupRootNames,
      operations,
      queueMutation,
      refreshOpenFolder,
      selectedIds,
      setFiles,
      setSelectedIds,
      setSelectionMode,
    ],
  );

  const batchStar = useCallback(() => {
    if (selectedIds.length === 0) return;
    const rows = files.filter((file) => selectedIds.includes(file.id));
    if (rows.length === 0) return;

    const nextValue = !selectedIds.every((id) => starred[id]);
    const previousStarred = { ...starred };
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
      execute: async (signal) => {
        if (!operations) return;
        await Promise.all(
          rows.map((file) =>
            operations.setStar(
              {
                path: resolveDriveFileApiPath(file, currentUsername, groupRootNames),
                starred: nextValue,
              },
              { signal },
            ),
          ),
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
    files,
    groupRootNames,
    operations,
    queueMutation,
    reloadStarredFromServer,
    selectedIds,
    setStarred,
    starred,
    viewType,
  ]);

  const moveToFolder = useCallback(
    (ids: string[], parent: string) => {
      if (ids.length === 0) return;
      const rows = files.filter((file) => ids.includes(file.id));
      if (rows.length === 0) return;

      const snapshots: MoveSnapshot[] = rows.map((file) => ({
        file,
        previousParent: file.parent,
      }));
      const { rollback } = beginOptimisticUpdate({
        ids,
        updater: (file) => ({ ...file, parent }),
      });

      runImmediateDriveBatch({
        queueMutation,
        key: `drive:move:${parent}:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} to ${parent.split("/").pop()}`,
        icon: <FolderInput className="size-4" />,
        undoToastMessage: "Move undone.",
        rollback,
        execute: async (signal, markCompleted) => {
          if (!operations) return;
          const destination = apiPathFromUiPath(parent, currentUsername, groupRootNames);
          for (const file of rows) {
            const from = resolveDriveFileApiPath(file, currentUsername, groupRootNames);
            await operations.renameItem({ destination, from, to: file.title }, { signal });
            markCompleted(file.id);
          }
          await refreshOpenFolderAfterBatch(refreshOpenFolder, signal);
        },
        revert: async (completedKeys) => {
          if (!operations) return;
          await finishDriveRestore({
            operations,
            completedKeys,
            username: currentUsername,
            groupRoots: groupRootNames,
            folderPath: view.type === "folder" ? view.path : "My Drive",
            setFiles,
            show,
            showError,
            moves: snapshots.map(({ file, previousParent }) => ({
              id: file.id,
              title: file.title,
              previousParent,
              from: resolveDriveFileApiPath(
                { ...file, apiPath: undefined, parent },
                currentUsername,
                groupRootNames,
              ),
            })),
          });
        },
      });
    },
    [
      beginOptimisticUpdate,
      currentUsername,
      files,
      groupRootNames,
      operations,
      queueMutation,
      refreshOpenFolder,
      setFiles,
      show,
      showError,
      view,
    ],
  );

  return { moveToTrash, reallyDelete, batchStar, moveToFolder };
}
