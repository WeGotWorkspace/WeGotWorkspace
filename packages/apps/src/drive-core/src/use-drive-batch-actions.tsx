import { useCallback, type Dispatch, type SetStateAction } from "react";
import { FolderInput, Star, StarOff, Trash2 } from "lucide-react";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import { runImmediateDriveBatch as queueImmediateDriveBatch } from "@/drive-core/src/run-immediate-drive-batch";
import type { BeginOptimisticUpdateFn } from "@/hooks/use-entity-batch-actions";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  reloadDriveFolderListing,
  resolveDriveFileApiPath,
  resolveTrashName,
} from "@/drive-core/src/drive-batch-utils";
import { apiPathFromUiPath, DRIVE_TRASH_UI_PATH } from "@/drive-core/src/drive-path-utils";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

type QueueMutation = (args: DeferredApiWriteArgs) => void;

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

  const runImmediateDriveBatch = useCallback(
    (args: {
      key: string;
      toastMessage: string;
      icon: React.ReactNode;
      undoToastMessage: string;
      rollback: () => void;
      execute: (signal: AbortSignal) => Promise<void>;
      revert?: () => Promise<void>;
    }) => {
      queueImmediateDriveBatch({ ...args, operations, queueMutation });
    },
    [operations, queueMutation],
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

      setFiles((prev) =>
        prev.map((file) =>
          ids.includes(file.id) ? { ...file, parent: DRIVE_TRASH_UI_PATH } : file,
        ),
      );
      clearSelectionForIds(ids);

      runImmediateDriveBatch({
        key: `drive:trash:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} to Trash`,
        icon: <Trash2 className="size-4" />,
        undoToastMessage: "Move to trash undone.",
        rollback: () => {
          setFiles(previousFiles);
          setSelectedIds(previousSelectedIds);
          if (previousSelectedIds.length > 0) setSelectionMode(true);
        },
        execute: async (signal) => {
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
            const to = resolveTrashName(file.title, trashNames);
            trashNames.add(to);
            await operations.renameItem({ destination, from, to }, { signal });
          }
          await refreshOpenFolder(signal);
        },
        revert: async () => {
          if (!operations) return;
          for (const { file, previousParent } of snapshots) {
            const from = resolveDriveFileApiPath(
              { ...file, parent: DRIVE_TRASH_UI_PATH },
              currentUsername,
              groupRootNames,
            );
            const destination = apiPathFromUiPath(previousParent, currentUsername, groupRootNames);
            await operations.renameItem({ destination, from, to: file.title });
          }
          await reloadDriveFolderListing(
            operations,
            view.type === "folder" ? view.path : "My Drive",
            currentUsername,
            groupRootNames,
            setFiles,
          );
        },
      });
    },
    [
      clearSelectionForIds,
      currentUsername,
      files,
      groupRootNames,
      operations,
      refreshOpenFolder,
      runImmediateDriveBatch,
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
      const rows = files.filter((file) => ids.includes(file.id));
      if (rows.length === 0) return;

      const previousFiles = files;
      const previousSelectedIds = selectedIds;

      setFiles((prev) => prev.filter((file) => !ids.includes(file.id)));
      clearSelectionForIds(ids);

      runImmediateDriveBatch({
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
          await refreshOpenFolder(signal);
        },
      });
    },
    [
      clearSelectionForIds,
      currentUsername,
      files,
      groupRootNames,
      operations,
      refreshOpenFolder,
      runImmediateDriveBatch,
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
        key: `drive:move:${parent}:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} to ${parent.split("/").pop()}`,
        icon: <FolderInput className="size-4" />,
        undoToastMessage: "Move undone.",
        rollback,
        execute: async (signal) => {
          if (!operations) return;
          const destination = apiPathFromUiPath(parent, currentUsername, groupRootNames);
          for (const file of rows) {
            const from = resolveDriveFileApiPath(file, currentUsername, groupRootNames);
            await operations.renameItem({ destination, from, to: file.title }, { signal });
          }
          await refreshOpenFolder(signal);
        },
        revert: async () => {
          if (!operations) return;
          for (const { file, previousParent } of snapshots) {
            const from = resolveDriveFileApiPath(
              { ...file, parent },
              currentUsername,
              groupRootNames,
            );
            const restoreDestination = apiPathFromUiPath(
              previousParent,
              currentUsername,
              groupRootNames,
            );
            await operations.renameItem({
              destination: restoreDestination,
              from,
              to: file.title,
            });
          }
          await reloadDriveFolderListing(
            operations,
            view.type === "folder" ? view.path : "My Drive",
            currentUsername,
            groupRootNames,
            setFiles,
          );
        },
      });
    },
    [
      beginOptimisticUpdate,
      currentUsername,
      files,
      groupRootNames,
      operations,
      refreshOpenFolder,
      runImmediateDriveBatch,
      setFiles,
      view,
    ],
  );

  return { moveToTrash, reallyDelete, batchStar, moveToFolder };
}
