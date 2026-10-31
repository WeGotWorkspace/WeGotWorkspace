import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { driveFileFromEntry, formatBytesCompact } from "@/drive-core/src/drive-file-utils";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import { apiPathFromUiPath, uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import {
  driveUploadDoneView,
  driveUploadProgressView,
  driveUploadStartView,
  queuePickedDriveUploads,
  type DriveUploadProgressView,
} from "@/drive-core/src/drive-upload-listing";
import { useDriveUploadBatchToasts } from "@/drive-core/src/use-drive-upload-batch-toasts";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";

const DONE_BAR_MS = 1400;

/**
 * The upload action (picker and drop). Signed in with the offline layer,
 * files go to the local upload queue: the toast says they were added, and
 * says "Uploaded" only once the batch is on the server. Without a queue
 * (mock, guest), files upload directly behind the floating progress bar.
 */
export function useDriveUploadAction(shell: DriveShellState, uploadEnabled: boolean) {
  const { show, showError } = useAppToast();
  const { view, commitView, currentUsername, groupRootNames, operations, setFiles } = shell;
  const [uploadProgress, setUploadProgress] = useState<DriveUploadProgressView | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const showUploadToast = useCallback(
    (message: string) => show(message, { icon: <Upload className="size-4" /> }),
    [show],
  );
  const trackBatch = useDriveUploadBatchToasts(operations, { show: showUploadToast, showError });

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const finishDirectUpload = (count: number) => {
    setUploadProgress(driveUploadDoneView(count));
    resetTimerRef.current = window.setTimeout(() => {
      setUploadProgress(null);
      resetTimerRef.current = null;
    }, DONE_BAR_MS);
    showUploadToast(driveLabels.uploadDoneToast(count));
  };

  const handleUpload = (fileList: FileList | null) => {
    if (!uploadEnabled || !fileList || fileList.length === 0) return;
    const selected = Array.from(fileList);
    const targetParent = view.type === "folder" ? view.path : "My Drive";
    const cwd = apiPathFromUiPath(targetParent, currentUsername, groupRootNames);
    const queued = queuePickedDriveUploads(operations, { cwd, files: selected }, showError, (b) => {
      trackBatch(b.batchId, b.itemIds);
      showUploadToast(driveLabels.uploadAddedToast(selected.length));
    });
    if (queued) {
      // Placeholders appear through the queue subscription.
      if (view.type !== "folder") commitView({ type: "folder", path: targetParent });
      return;
    }
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setUploadProgress(driveUploadStartView(selected));
    if (operations) {
      void operations
        .checkUploadReady()
        .then(() =>
          operations.uploadFiles(
            { cwd, files: selected },
            { onProgress: (progress) => setUploadProgress(driveUploadProgressView(progress)) },
          ),
        )
        .then((nextData) => {
          setFiles(
            nextData.directory.files.map((entry) => driveFileFromEntry(entry, currentUsername)),
          );
          commitView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, currentUsername) });
          finishDirectUpload(selected.length);
        })
        .catch((error: unknown) => {
          setUploadProgress(null);
          showError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    setFiles((previous) => [...mockUploadedFiles(selected, targetParent), ...previous]);
    finishDirectUpload(selected.length);
  };

  return { handleUpload, uploadProgress };
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
