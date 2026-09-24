import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { runQueuedBatchAction } from "@/hooks/use-batch-actions";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import { useAppToast } from "@/hooks/use-app-toast";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  captureOfflineDocsTrashSnapshot,
  type DocsTrashUndoSnapshot,
  undoOfflineDocsTrash,
} from "@/lib/offline/docs/docs-hybrid-operations";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  resolveTrashName,
} from "@/drive-core/src/drive-batch-utils";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_UI_PATH,
  normalizeApiVirtualPath,
} from "@/drive-core/src/drive-path-utils";
import { parentAndName } from "@/lib/files/api-path";
import { joinFileNameForRename, splitFileNameForRename } from "@/lib/files/filename-rename";

const WRITE_QUEUE_DELAY_MS = 2500;

type DocsTrashMoveSnapshot = {
  file: DriveFile;
  /** Actual server path under `.Trash` (may differ from title when names collide). */
  trashPath: string;
};

export type DocsHomeRenameState = { id: string; extension: string };
export type DocsHomeMoveState = { ids: string[] };
export type DocsHomeDeleteState = { ids: string[]; permanent?: boolean };

type UseDocsHomeActionsArgs = {
  /** Live drive operations (star/download/rename/move/trash). Undefined in mock-only shells. */
  operations?: DriveAPIOperations;
  /** Currently loaded home files (used to resolve ids → api paths). */
  files: DriveFile[];
  /** Current user handle, for resolving My Drive / group api paths on move. */
  username: string;
  /** Known group roots, so move destinations under `Groups/*` resolve correctly. */
  groupRoots: string[];
  /** When set, enables offline trash undo (outbox + listing cache reversal). */
  offlineUsername?: string | null;
  /** Refresh offline pin/availability badges after trash or undo. */
  onAvailabilityChanged?: () => void;
  /** Refresh the home list after a mutation that changes the listing. */
  reload: () => void;
  /** When true, delete confirms permanently remove files instead of moving to Trash. */
  inTrashView?: boolean;
};

export function useDocsHomeActions({
  operations,
  files,
  username,
  groupRoots,
  offlineUsername = null,
  onAvailabilityChanged,
  reload,
  inTrashView = false,
}: UseDocsHomeActionsArgs) {
  const { show, showError } = useAppToast();
  const showMutationError = useCallback(
    (fallback = "Could not move this file to Trash.") => showError(fallback),
    [showError],
  );
  const { queueMutation, undoLatest } = useQueuedMutation({
    delayMs: WRITE_QUEUE_DELAY_MS,
    onMutationError: showMutationError,
  });
  const [hiddenFileIds, setHiddenFileIds] = useState<Set<string>>(() => new Set());

  const filesById = useMemo(() => {
    const map = new Map<string, DriveFile>();
    for (const file of files) map.set(file.id, file);
    return map;
  }, [files]);
  const fileById = useCallback((id: string) => filesById.get(id), [filesById]);

  const groupRootNames = useMemo(() => new Set(groupRoots), [groupRoots]);

  const [starredPaths, setStarredPaths] = useState<Set<string>>(new Set());
  const [starsReady, setStarsReady] = useState(!operations);
  const [renameState, setRenameState] = useState<DocsHomeRenameState | null>(null);
  const [renameName, setRenameName] = useState("");
  const [moveState, setMoveState] = useState<DocsHomeMoveState | null>(null);
  const [deleteState, setDeleteState] = useState<DocsHomeDeleteState | null>(null);

  useEffect(() => {
    if (!operations) {
      setStarsReady(true);
      return;
    }
    setStarsReady(false);
    const controller = new AbortController();
    void operations
      .listStars({ signal: controller.signal })
      .then((paths) => {
        if (controller.signal.aborted) return;
        setStarredPaths(new Set(paths.map((path) => normalizeApiVirtualPath(path))));
        setStarsReady(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStarsReady(true);
      });
    return () => controller.abort();
  }, [operations]);

  /** Star map keyed by file id (search ids differ from api paths, so resolve per file). */
  const starred = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const file of files) {
      if (file.apiPath && starredPaths.has(normalizeApiVirtualPath(file.apiPath))) {
        map[file.id] = true;
      }
    }
    return map;
  }, [files, starredPaths]);

  const onStar = useCallback(
    (id: string) => {
      const file = fileById(id);
      const apiPath = file?.apiPath ? normalizeApiVirtualPath(file.apiPath) : null;
      if (!apiPath) return;
      const beforeStarred = starredPaths.has(apiPath);
      const next = !beforeStarred;
      const toastIcon = next ? (
        <Star className="size-4" fill="currentColor" />
      ) : (
        <StarOff className="size-4" />
      );
      setStarredPaths((prev) => {
        const updated = new Set(prev);
        if (next) updated.add(apiPath);
        else updated.delete(apiPath);
        return updated;
      });
      // Match Drive: offline/mock → regular toast; live → undoable toast only.
      if (!operations) {
        show(next ? "Starred" : "Unstarred", { icon: toastIcon });
        return;
      }
      const rollback = () => {
        setStarredPaths((prev) => {
          const updated = new Set(prev);
          if (beforeStarred) updated.add(apiPath);
          else updated.delete(apiPath);
          return updated;
        });
      };
      queueMutation({
        key: `docs:star:${id}`,
        toastMessage: next ? "Starred" : "Unstarred",
        icon: toastIcon,
        execute: async (signal) => {
          await operations.setStar({ path: apiPath, starred: next }, { signal });
        },
        undo: rollback,
        onError: () => {
          rollback();
          showError("Could not update star.");
        },
        undoToastMessage: "Star change undone.",
      });
    },
    [fileById, operations, queueMutation, show, showError, starredPaths],
  );

  const onDownload = useCallback(
    (file: DriveFile) => {
      if (!operations || !file.apiPath) return;
      void operations
        .downloadFile(file.apiPath)
        .then(() => show("Download started", { icon: <Download className="size-4" /> }))
        .catch((error: unknown) => {
          showError(error instanceof Error ? error.message : "Could not download this file.");
        });
    },
    [operations, show, showError],
  );

  const onRename = useCallback((file: DriveFile) => {
    const { baseName, extension, hasExtension } = splitFileNameForRename(file.title);
    setRenameState({ id: file.id, extension: hasExtension ? extension : "" });
    setRenameName(baseName);
  }, []);

  const closeRename = useCallback(() => {
    setRenameState(null);
    setRenameName("");
  }, []);

  const submitRename = useCallback(() => {
    if (!renameState) return;
    const file = fileById(renameState.id);
    const apiPath = file?.apiPath ? normalizeApiVirtualPath(file.apiPath) : null;
    const nextName = renameState.extension
      ? joinFileNameForRename(renameName, renameState.extension)
      : renameName.trim();
    if (!file || !apiPath || !nextName || nextName === file.title) {
      closeRename();
      return;
    }
    closeRename();
    if (!operations) return;
    const { destination } = parentAndName(apiPath);
    void operations
      .renameItem({ destination, from: apiPath, to: nextName })
      .then(() => {
        show(`Renamed to “${nextName}”`, { icon: <Pencil className="size-4" /> });
        reload();
      })
      .catch((error: unknown) => {
        showError(error instanceof Error ? error.message : "Could not rename this file.");
      });
  }, [closeRename, fileById, operations, reload, renameName, renameState, show, showError]);

  const onMove = useCallback((file: DriveFile) => setMoveState({ ids: [file.id] }), []);
  const closeMove = useCallback(() => setMoveState(null), []);

  const requestMoveSelected = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setMoveState({ ids });
  }, []);

  const confirmMove = useCallback(
    (destinationUiPath: string) => {
      const state = moveState;
      closeMove();
      if (!state || !operations) return;
      const rows = state.ids
        .map((id) => fileById(id))
        .filter((file): file is DriveFile => !!file?.apiPath);
      if (rows.length === 0) return;
      const destination = apiPathFromUiPath(destinationUiPath, username, groupRootNames);
      void (async () => {
        try {
          for (const file of rows) {
            const apiPath = normalizeApiVirtualPath(file.apiPath!);
            await operations.renameItem({ destination, from: apiPath, to: file.title });
          }
          show(rows.length === 1 ? `Moved “${rows[0]!.title}”` : `Moved ${rows.length} files`);
          reload();
        } catch (error: unknown) {
          showError(error instanceof Error ? error.message : "Could not move this file.");
        }
      })();
    },
    [closeMove, fileById, groupRootNames, moveState, operations, reload, show, showError, username],
  );

  const onTrash = useCallback(
    (file: DriveFile) => setDeleteState({ ids: [file.id], permanent: inTrashView }),
    [inTrashView],
  );
  const closeDelete = useCallback(() => setDeleteState(null), []);

  const requestDeleteSelected = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setDeleteState({ ids, permanent: inTrashView });
    },
    [inTrashView],
  );

  const confirmTrash = useCallback(() => {
    const state = deleteState;
    closeDelete();
    if (!state || !operations) return;
    const rows = state.ids
      .map((id) => fileById(id))
      .filter((file): file is DriveFile => !!file?.apiPath);
    if (rows.length === 0) return;

    const ids = rows.map((file) => file.id);
    setHiddenFileIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });

    const rollbackUi = () => {
      setHiddenFileIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      reload();
    };

    if (state.permanent) {
      runQueuedBatchAction({
        queueMutation,
        key: `docs:delete:${ids.slice().sort().join(",")}`,
        toastMessage:
          rows.length === 1 ? `Deleted “${rows[0]!.title}”` : `Deleted ${rows.length} files`,
        icon: <Trash2 className="size-4" />,
        undoToastMessage: "Delete undone.",
        rollback: rollbackUi,
        executeImmediately: true,
        execute: async (signal) => {
          await operations.deleteItems(
            rows.map((file) => normalizeApiVirtualPath(file.apiPath!)),
            { signal },
          );
          reload();
          onAvailabilityChanged?.();
        },
      });
      return;
    }

    let completed = false;
    let offlineSnapshots: DocsTrashUndoSnapshot[] = [];
    let trashSnapshots: DocsTrashMoveSnapshot[] = [];

    const revertTrash = async () => {
      if (offlineUsername && offlineSnapshots.length > 0) {
        for (const snapshot of offlineSnapshots) {
          await undoOfflineDocsTrash(offlineUsername, snapshot);
        }
      }
      if (readBrowserOnline() && trashSnapshots.length > 0) {
        for (const { file, trashPath } of trashSnapshots) {
          try {
            const destination = apiPathFromUiPath(file.parent, username, groupRootNames);
            await operations.renameItem({ destination, from: trashPath, to: file.title });
          } catch {
            // Offline-only trash never reached server trash; local undo above is enough.
          }
        }
      }
      reload();
      onAvailabilityChanged?.();
    };

    const undo = () => {
      rollbackUi();
      if (completed) {
        void revertTrash().catch(() => undefined);
      }
    };

    runQueuedBatchAction({
      queueMutation,
      key: `docs:trash:${ids.slice().sort().join(",")}`,
      toastMessage:
        rows.length === 1
          ? `Moved “${rows[0]!.title}” to Trash`
          : `Moved ${rows.length} files to Trash`,
      icon: <Trash2 className="size-4" />,
      undoToastMessage: "Move to trash undone.",
      rollback: undo,
      executeImmediately: true,
      execute: async (signal) => {
        if (offlineUsername) {
          offlineSnapshots = await Promise.all(
            rows.map((file) => captureOfflineDocsTrashSnapshot(offlineUsername, file.apiPath!)),
          );
        }
        await ensureTrashFolder(operations, username, groupRootNames, signal);
        const destination = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, username, groupRootNames);
        const trashNames = await listTrashEntryNames(operations, destination, signal);
        trashSnapshots = [];
        for (const file of rows) {
          const apiPath = normalizeApiVirtualPath(file.apiPath!);
          const to = resolveTrashName(file.title, trashNames);
          trashNames.add(to);
          await operations.renameItem({ destination, from: apiPath, to }, { signal });
          trashSnapshots.push({
            file,
            trashPath: normalizeApiVirtualPath(`${destination}/${to}`),
          });
        }
        completed = true;
        reload();
        onAvailabilityChanged?.();
      },
    });
  }, [
    closeDelete,
    deleteState,
    fileById,
    groupRootNames,
    offlineUsername,
    onAvailabilityChanged,
    operations,
    queueMutation,
    reload,
    username,
  ]);

  const batchStar = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = ids
        .map((id) => fileById(id))
        .filter((file): file is DriveFile => !!file?.apiPath);
      if (rows.length === 0) return;

      const nextValue = !ids.every((id) => {
        const file = fileById(id);
        const apiPath = file?.apiPath ? normalizeApiVirtualPath(file.apiPath) : null;
        return apiPath ? starredPaths.has(apiPath) : false;
      });

      const previousPaths = new Set(starredPaths);
      const toastIcon = nextValue ? (
        <Star className="size-4" fill="currentColor" />
      ) : (
        <StarOff className="size-4" />
      );

      setStarredPaths((prev) => {
        const updated = new Set(prev);
        for (const file of rows) {
          const apiPath = normalizeApiVirtualPath(file.apiPath!);
          if (nextValue) updated.add(apiPath);
          else updated.delete(apiPath);
        }
        return updated;
      });

      if (!operations) {
        show(nextValue ? "Starred" : "Unstarred", { icon: toastIcon });
        return;
      }

      runQueuedBatchAction({
        queueMutation,
        key: `docs:batch-star:${ids.slice().sort().join(",")}`,
        toastMessage: nextValue ? "Starred" : "Unstarred",
        icon: toastIcon,
        execute: async (signal) => {
          await Promise.all(
            rows.map((file) =>
              operations.setStar(
                {
                  path: normalizeApiVirtualPath(file.apiPath!),
                  starred: nextValue,
                },
                { signal },
              ),
            ),
          );
        },
        rollback: () => setStarredPaths(previousPaths),
        undoToastMessage: "Star changes undone.",
      });
    },
    [fileById, operations, queueMutation, show, starredPaths],
  );

  return {
    starred,
    starredPaths,
    starsReady,
    fileById,
    hiddenFileIds,
    undoLatest,
    onStar,
    onDownload,
    onRename,
    onMove,
    onTrash,
    renameState,
    renameName,
    setRenameName,
    submitRename,
    closeRename,
    moveState,
    closeMove,
    confirmMove,
    deleteState,
    closeDelete,
    confirmTrash,
    batchStar,
    requestMoveSelected,
    requestDeleteSelected,
  };
}

export type DocsHomeActions = ReturnType<typeof useDocsHomeActions>;
