import { useCallback, useRef } from "react";
import { Upload } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { driveFileFromEntry, formatBytesCompact } from "@/drive-core/src/drive-file-utils";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import { apiPathFromUiPath, uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import { queuePickedDriveUploads } from "@/drive-core/src/drive-upload-listing";
import {
  droppedFolderEntries,
  driveUploadTreeFromEntries,
  driveUploadTreeFromFileList,
  type DriveUploadTree,
} from "@/drive-core/src/drive-upload-folder-walk";
import { useDriveUploadBatchDialog } from "@/drive-core/src/use-drive-upload-batch-dialog";
import { useDriveUploadBatchToasts } from "@/drive-core/src/use-drive-upload-batch-toasts";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";

/**
 * The upload action (picker and drop). Signed in with the offline layer,
 * files go to the local upload queue: the toast says they were added, and
 * says "Uploaded" only once the batch is on the server. Without a queue
 * (mock, guest), files upload directly: a toast when they start and one
 * when they are done. The floating progress bar is gone (#1522).
 * Folders (picked or dropped) go to the queue as one tree (#1620); without a
 * queue there is no folder upload.
 */
export function useDriveUploadAction(shell: DriveShellState, uploadEnabled: boolean) {
  const { show, showError } = useAppToast();
  const { view, commitView, currentUsername, groupRootNames, operations, setFiles } = shell;
  const showUploadToast = useCallback(
    (message: string) => show(message, { icon: <Upload className="size-4" /> }),
    [show],
  );
  const trackBatch = useDriveUploadBatchToasts(operations, { show: showUploadToast, showError });
  const onBatchStored = useCallback(
    (batch: { batchId: string; itemIds: readonly string[] }) => {
      trackBatch(batch.batchId, batch.itemIds);
      showUploadToast(
        batch.itemIds.length > 0
          ? driveLabels.uploadAddedToast(batch.itemIds.length)
          : driveLabels.uploadFolderAddedToast,
      );
    },
    [showUploadToast, trackBatch],
  );
  const batchDialog = useDriveUploadBatchDialog(operations, showError, onBatchStored);

  const finishDirectUpload = (count: number) => {
    showUploadToast(driveLabels.uploadDoneToast(count));
  };

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const canUploadFolders =
    uploadEnabled && Boolean(operations?.enqueueUploads && operations.releaseUploadBatch);
  const uploadTarget = () => {
    const targetParent = view.type === "folder" ? view.path : "My Drive";
    return {
      targetParent,
      cwd: apiPathFromUiPath(targetParent, currentUsername, groupRootNames),
    };
  };

  const queueTree = (tree: DriveUploadTree) => {
    if (tree.skipped > 0) showUploadToast(driveLabels.uploadSkippedToast(tree.skipped));
    if (tree.folders.length === 0 && tree.files.length === 0) return;
    const { targetParent, cwd } = uploadTarget();
    const input = { cwd, files: [], tree };
    if (queuePickedDriveUploads(operations, input, showError, onBatchStored, batchDialog.ask)) {
      if (view.type !== "folder") commitView({ type: "folder", path: targetParent });
    }
  };

  /** `<input webkitdirectory>`: one folder with everything in it. */
  const handleUploadFolder = (fileList: FileList | null) => {
    if (!canUploadFolders || !fileList || fileList.length === 0) return;
    queueTree(driveUploadTreeFromFileList(Array.from(fileList)));
  };

  /** A drop with a folder in it walks the tree; a drop of files only stays a file upload. */
  const handleUploadDrop = (dataTransfer: DataTransfer) => {
    // Read now: the browser empties the items once the drop event returns.
    const entries = canUploadFolders ? droppedFolderEntries(dataTransfer.items) : null;
    if (!entries) {
      handleUpload(dataTransfer.files);
      return;
    }
    void driveUploadTreeFromEntries(entries)
      .then(queueTree)
      .catch((error: unknown) => {
        showError(error instanceof Error ? error.message : String(error));
      });
  };

  const handleUpload = (fileList: FileList | null) => {
    if (!uploadEnabled || !fileList || fileList.length === 0) return;
    const selected = Array.from(fileList);
    const { targetParent, cwd } = uploadTarget();
    const queued = queuePickedDriveUploads(
      operations,
      { cwd, files: selected },
      showError,
      onBatchStored,
      batchDialog.ask,
    );
    if (queued) {
      // Placeholders appear through the queue subscription.
      if (view.type !== "folder") commitView({ type: "folder", path: targetParent });
      return;
    }
    if (operations) {
      showUploadToast(
        selected.length === 1
          ? driveLabels.uploadingFile(selected[0]!.name)
          : driveLabels.uploadingFiles(selected.length),
      );
      void operations
        .checkUploadReady()
        .then(() => operations.uploadFiles({ cwd, files: selected }))
        .then((nextData) => {
          setFiles(
            nextData.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
          );
          commitView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, currentUsername) });
          finishDirectUpload(selected.length);
        })
        .catch((error: unknown) => {
          showError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    setFiles((previous) => [...mockUploadedFiles(selected, targetParent), ...previous]);
    finishDirectUpload(selected.length);
  };

  return {
    handleUpload,
    handleUploadFolder,
    handleUploadDrop,
    canUploadFolders,
    folderInputRef,
    uploadBatchDialog: batchDialog.dialog,
  };
}

/** Storybook / mock Drive: files appear at once, nothing leaves the browser. */
function mockUploadedFiles(selected: readonly File[], parent: string): DriveFile[] {
  return selected.map((file, i) => {
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
      notebook: `${kind[0]!.toUpperCase()}${kind.slice(1)} · ${size}`,
      category: kind,
      date: "Now",
      title: file.name,
      excerpt: `Uploaded just now · ${size}`,
      body: [],
      tags: [],
      wordCount: 0,
      parent,
      kind,
      size,
    };
  });
}
