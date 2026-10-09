import { useCallback, useEffect, useRef, useState } from "react";
import { Star, StarOff, Upload, FolderPlus, Pencil, ScrollText } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { canMoveDriveItemsToFolder } from "@/drive-core/src/drive-item-path";
import { resolveDriveFileApiPath } from "@/drive-core/src/drive-batch-utils";
import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import {
  apiPathFromUiPath,
  normalizeApiVirtualPath,
  uiPathFromApiPath,
} from "@/drive-core/src/drive-path-utils";
import { formatBytesCompact } from "@/drive-core/src/drive-file-utils";
import { resolveCreateMarkdownDialogDefaults } from "@/drive-core/src/drive-create-markdown-dialog-utils";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import type { DriveUploadProgress } from "@/drive-core/src/drive-types";
import { useDriveBatchActions } from "@/drive-core/src/use-drive-batch-actions";
import { useDriveSelectionBar } from "@/drive-core/src/use-drive-selection-bar";
import type { DriveListState } from "@/drive-core/src/use-drive-list";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";
import { joinFileNameForRename, splitFileNameForRename } from "@/lib/files/filename-rename";

export type UseDriveMutationsArgs = {
  shell: DriveShellState;
  list: DriveListState;
  onOpenDocsFile?: (apiPath: string) => void;
};

export function useDriveMutations({ shell, list, onOpenDocsFile }: UseDriveMutationsArgs) {
  const { show, showError } = useAppToast();

  const {
    labels,
    files,
    setFiles,
    view,
    commitView,
    currentUsername,
    groupRootNames,
    operations,
    starred,
    setStarred,
    reloadStarredFromServer,
    inTrashView,
    isUnderTrash,
  } = shell;

  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    activeId,
    setActiveId,
    setDetailOpen,
    fileById,
    exitSelection,
    dropZoneProps,
    queueMutation,
    beginOptimisticUpdate,
  } = list;

  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDialog, setRenameDialog] = useState<null | { id: string; extension: string }>(null);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<null | { ids: string[]; permanent: boolean }>(
    null,
  );
  const [moveDialog, setMoveDialog] = useState<{ ids: string[] } | null>(null);
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false);
  const [markdownDialogSubmitting, setMarkdownDialogSubmitting] = useState(false);
  const [markdownDialogError, setMarkdownDialogError] = useState<string | null>(null);
  const [dropUploadActive, setDropUploadActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    label: string;
    percent: number;
    detail: string;
    done: boolean;
  } | null>(null);
  const uploadProgressResetTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetRenameDialog = useCallback(() => {
    setRenameDialog(null);
    setRenameName("");
  }, []);

  const { moveToTrash, reallyDelete, batchStar, moveToFolder } = useDriveBatchActions({
    files,
    setFiles,
    selectedIds,
    setSelectedIds,
    selectionMode,
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
    viewType: view.type,
  });

  const toggleStar = (id: string) => {
    const target = fileById(id);
    if (!target) return;
    const beforeStarred = !!starred[id];
    const nextValue = !beforeStarred;
    setStarred((s) => ({ ...s, [id]: nextValue }));
    if (!operations) {
      show(nextValue ? "Starred" : "Unstarred", {
        icon: nextValue ? (
          <Star className="size-4" fill="currentColor" />
        ) : (
          <StarOff className="size-4" />
        ),
      });
      return;
    }
    const apiPath = resolveDriveFileApiPath(target, currentUsername, groupRootNames);
    queueMutation({
      key: `drive:star:${id}`,
      toastMessage: nextValue ? "Starred" : "Unstarred",
      icon: nextValue ? (
        <Star className="size-4" fill="currentColor" />
      ) : (
        <StarOff className="size-4" />
      ),
      execute: async (signal) => {
        await operations.setStar({ path: apiPath, starred: nextValue }, { signal });
        if (view.type === "starred") reloadStarredFromServer();
      },
      undo: () => {
        setStarred((s) => ({ ...s, [id]: beforeStarred }));
        if (view.type === "starred") reloadStarredFromServer();
      },
      onError: () => {
        setStarred((s) => ({ ...s, [id]: beforeStarred }));
        if (view.type === "starred") reloadStarredFromServer();
      },
      undoToastMessage: "Star change undone.",
    });
  };

  const commitMoveToFolder = useCallback(
    (ids: string[], destinationPath: string) => {
      const movable = canMoveDriveItemsToFolder(files, ids, destinationPath);
      if (movable.length > 0) moveToFolder(movable, destinationPath);
    },
    [files, moveToFolder],
  );

  const folderDropZoneProps = useCallback(
    (destinationPath: string) =>
      dropZoneProps(destinationPath, (ids) => commitMoveToFolder(ids, destinationPath)),
    [commitMoveToFolder, dropZoneProps],
  );

  const requestDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    setConfirmDelete({ ids: selectedIds, permanent: inTrashView });
  };
  const requestDeleteItem = (file: DriveFile) => {
    setConfirmDelete({ ids: [file.id], permanent: isUnderTrash(file.parent) });
  };
  const requestRenameItem = (file: DriveFile) => {
    const isFolder = file.kind === "folder";
    const { baseName, extension, hasExtension } = splitFileNameForRename(file.title);
    setRenameDialog({
      id: file.id,
      extension: isFolder || !hasExtension ? "" : extension,
    });
    setRenameName(isFolder ? file.title : baseName);
  };
  const openMoveDialog = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setMoveDialog({ ids });
  }, []);
  const requestMoveSelected = () => openMoveDialog(selectedIds);
  const requestMoveItem = (file: DriveFile) => openMoveDialog([file.id]);

  const submitRenameItem = () => {
    if (!renameDialog) return;
    const file = fileById(renameDialog.id);
    if (!file) {
      resetRenameDialog();
      return;
    }
    const lockedExtension = renameDialog.extension;
    const nextName = lockedExtension
      ? joinFileNameForRename(renameName, lockedExtension)
      : renameName.trim();
    if (!nextName || nextName === file.title) {
      resetRenameDialog();
      return;
    }
    const previousName = file.title;
    setFiles((prev) =>
      prev.map((item) => (item.id === file.id ? { ...item, title: nextName } : item)),
    );
    resetRenameDialog();
    show(`Renamed to “${nextName}”`, { icon: <Pencil className="size-4" /> });
    if (!operations) return;
    const destination = apiPathFromUiPath(file.parent, currentUsername, groupRootNames);
    const fromPath = file.apiPath ?? normalizeApiVirtualPath(`${destination}/${previousName}`);
    void operations
      .renameItem({
        destination,
        from: fromPath,
        to: nextName,
      })
      .then((nextData) => {
        setFiles(
          nextData.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
        );
        commitView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, currentUsername) });
      })
      .catch((error: unknown) => {
        setFiles((prev) =>
          prev.map((item) => (item.id === file.id ? { ...item, title: previousName } : item)),
        );
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      });
  };

  const handleUpload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const selected = Array.from(fileList);
    const targetParent = view.type === "folder" ? view.path : "My Drive";
    const showProgress = (progress: DriveUploadProgress) => {
      const totalBytes = Math.max(1, progress.totalBytes);
      const percent = Math.min(100, Math.round((progress.uploadedBytes / totalBytes) * 100));
      const fileLabel =
        progress.currentFileName.trim() !== ""
          ? `Uploading ${progress.currentFileName}`
          : "Uploading files";
      const detail = `${formatBytesCompact(progress.uploadedBytes)} / ${formatBytesCompact(progress.totalBytes)} · ${progress.filesCompleted}/${progress.filesTotal} files`;
      setUploadProgress({ label: fileLabel, percent, detail, done: false });
    };
    if (uploadProgressResetTimerRef.current !== null) {
      window.clearTimeout(uploadProgressResetTimerRef.current);
      uploadProgressResetTimerRef.current = null;
    }
    setUploadProgress({
      label:
        selected.length === 1
          ? `Uploading ${selected[0]!.name}`
          : `Uploading ${selected.length} files`,
      percent: 0,
      detail: `0 / ${formatBytesCompact(selected.reduce((sum, file) => sum + file.size, 0))}`,
      done: false,
    });
    if (operations) {
      void operations
        .checkUploadReady()
        .then(() =>
          operations.uploadFiles(
            {
              cwd: apiPathFromUiPath(targetParent, currentUsername, groupRootNames),
              files: selected,
            },
            { onProgress: showProgress },
          ),
        )
        .then((nextData) => {
          setFiles(
            nextData.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
          );
          commitView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, currentUsername) });
          setUploadProgress({
            label: `Uploaded ${selected.length} file${selected.length === 1 ? "" : "s"}`,
            percent: 100,
            detail: "Upload complete",
            done: true,
          });
          uploadProgressResetTimerRef.current = window.setTimeout(() => {
            setUploadProgress(null);
            uploadProgressResetTimerRef.current = null;
          }, 1400);
          show(`Uploaded ${selected.length} file${selected.length === 1 ? "" : "s"}`, {
            icon: <Upload className="size-4" />,
          });
        })
        .catch((error: unknown) => {
          setUploadProgress(null);
          const message = error instanceof Error ? error.message : String(error);
          showError(message);
        });
      return;
    }
    const created: DriveFile[] = selected.map((file, i) => {
      const kind: FileKind = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "audio"
            : /zip|tar|gzip/.test(file.type)
              ? "archive"
              : /pdf|text|document/.test(file.type)
                ? "doc"
                : "file";
      const size = formatBytesCompact(file.size);
      return {
        id: `f-${Date.now()}-${i}`,
        notebook: `${kind[0].toUpperCase()}${kind.slice(1)} · ${size}`,
        category: kind,
        date: "Now",
        title: file.name,
        excerpt: `Uploaded just now · ${size}`,
        body: [],
        tags: [],
        wordCount: 0,
        parent: targetParent,
        kind,
        size,
      };
    });
    setFiles((p) => [...created, ...p]);
    setUploadProgress({
      label: `Uploaded ${created.length} file${created.length === 1 ? "" : "s"}`,
      percent: 100,
      detail: "Upload complete",
      done: true,
    });
    uploadProgressResetTimerRef.current = window.setTimeout(() => {
      setUploadProgress(null);
      uploadProgressResetTimerRef.current = null;
    }, 1200);
    show(`Uploaded ${created.length} file${created.length === 1 ? "" : "s"}`, {
      icon: <Upload className="size-4" />,
    });
  };

  const createFolder = () => {
    setNewFolderName("");
    setNewFolderDialogOpen(true);
  };

  const submitCreateFolder = () => {
    const v = newFolderName.trim();
    if (!v) return;
    const targetParent = view.type === "folder" ? view.path : "My Drive";
    const id = `f-${Date.now()}`;
    setFiles((p) => [
      {
        id,
        notebook: "Folder",
        category: "Folder",
        date: "Now",
        title: v,
        excerpt: "0 items",
        body: [],
        tags: [],
        wordCount: 0,
        parent: targetParent,
        kind: "folder",
        size: "—",
      },
      ...p,
    ]);
    show(`Folder “${v}” created`, { icon: <FolderPlus className="size-4" /> });
    setNewFolderDialogOpen(false);
    setNewFolderName("");
    if (operations) {
      void operations
        .createFolder({
          cwd: apiPathFromUiPath(targetParent, currentUsername, groupRootNames),
          name: v,
        })
        .then((nextData) => {
          setFiles(
            nextData.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
          );
          commitView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, currentUsername) });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          showError(message);
        });
    }
  };

  const createMarkdown = useCallback(() => {
    if (!onOpenDocsFile) return;
    setMarkdownDialogError(null);
    setMarkdownDialogOpen(true);
  }, [onOpenDocsFile]);

  const closeMarkdownDialog = useCallback(() => {
    if (markdownDialogSubmitting) return;
    setMarkdownDialogOpen(false);
    setMarkdownDialogError(null);
  }, [markdownDialogSubmitting]);

  const submitCreateMarkdown = useCallback(
    (name: string, destinationPath: string) => {
      if (!onOpenDocsFile) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      const cwd = apiPathFromUiPath(destinationPath, currentUsername, groupRootNames);
      const apiPath = normalizeApiVirtualPath(`${cwd}/${trimmed}`);

      if (operations) {
        setMarkdownDialogSubmitting(true);
        setMarkdownDialogError(null);
        void operations
          .createFile({ cwd, name: trimmed })
          .then((nextData) => {
            setFiles(
              nextData.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
            );
            commitView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, currentUsername) });
            setMarkdownDialogOpen(false);
            setMarkdownDialogSubmitting(false);
            onOpenDocsFile(apiPath);
          })
          .catch((error: unknown) => {
            setMarkdownDialogSubmitting(false);
            const message = error instanceof Error ? error.message : String(error);
            setMarkdownDialogError(message);
            showError(message);
          });
        return;
      }

      const id = `f-${Date.now()}`;
      setFiles((previous) => [
        {
          id,
          notebook: "File · 0 KB",
          category: "File",
          date: "Now",
          title: trimmed,
          excerpt: apiPath,
          body: [],
          tags: [],
          wordCount: 0,
          parent: destinationPath,
          kind: "doc",
          size: "0 KB",
          apiPath,
        },
        ...previous,
      ]);
      show(`Created “${trimmed}”`, { icon: <ScrollText className="size-4" /> });
      setMarkdownDialogOpen(false);
      onOpenDocsFile(apiPath);
    },
    [
      commitView,
      currentUsername,
      groupRootNames,
      onOpenDocsFile,
      operations,
      setFiles,
      show,
      showError,
    ],
  );

  const markdownDialogDefaults = resolveCreateMarkdownDialogDefaults(view, files);

  useEffect(() => {
    return () => {
      if (uploadProgressResetTimerRef.current !== null) {
        window.clearTimeout(uploadProgressResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (inField) return;
      const macDelete = isMac && (e.key === "Backspace" || (e.metaKey && e.key === "Backspace"));
      const winDelete = !isMac && e.key === "Delete";
      if ((macDelete || winDelete) && selectedIds.length > 0) {
        e.preventDefault();
        setConfirmDelete({ ids: selectedIds, permanent: inTrashView });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds, inTrashView]);

  const { selectionBar } = useDriveSelectionBar({
    labels,
    files,
    selectedIds,
    selectionMode,
    activeId,
    inTrashView,
    operations,
    exitSelection,
    batchStar,
    requestDeleteSelected,
    requestMoveSelected,
  });

  return {
    newFolderDialogOpen,
    setNewFolderDialogOpen,
    newFolderName,
    setNewFolderName,
    renameDialog,
    setRenameDialog,
    renameName,
    setRenameName,
    confirmDelete,
    setConfirmDelete,
    moveDialog,
    setMoveDialog,
    markdownDialogOpen,
    markdownDialogDefaults,
    markdownDialogSubmitting,
    markdownDialogError,
    closeMarkdownDialog,
    submitCreateMarkdown,
    dropUploadActive,
    setDropUploadActive,
    uploadProgress,
    fileInputRef,
    toggleStar,
    batchStar,
    moveToTrash,
    moveToFolder,
    commitMoveToFolder,
    folderDropZoneProps,
    selectionBar,
    requestDeleteSelected,
    requestDeleteItem,
    requestMoveSelected,
    requestMoveItem,
    openMoveDialog,
    requestRenameItem,
    submitRenameItem,
    reallyDelete,
    handleUpload,
    createFolder,
    submitCreateFolder,
    createMarkdown,
    resetRenameDialog,
  };
}

export type DriveMutationsState = ReturnType<typeof useDriveMutations>;
