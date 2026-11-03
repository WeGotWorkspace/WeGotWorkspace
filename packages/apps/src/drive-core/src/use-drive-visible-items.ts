import { useMemo } from "react";
import { driveFilesFromUploadQueue } from "@/drive-core/src/drive-upload-files";
import { useDriveUploadQueue } from "@/drive-core/src/drive-upload-queue";
import { filterDriveVisibleItems } from "@/drive-core/src/drive-visible-items";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";

/** Rows the main pane shows for the current view, search, and (Uploads view) queue. */
export function useDriveVisibleItems(shell: DriveShellState) {
  const {
    files,
    liveSearchResults,
    starredItems,
    sharedItems,
    starred,
    view,
    searchQuery,
    currentUsername,
    operations,
    folderPickerRootLabels,
  } = shell;
  const uploadQueue = useDriveUploadQueue(view.type === "uploads" ? operations : undefined);
  const uploadFiles = useMemo(
    () =>
      uploadQueue
        ? driveFilesFromUploadQueue(uploadQueue, currentUsername, folderPickerRootLabels)
        : null,
    [currentUsername, folderPickerRootLabels, uploadQueue],
  );
  return useMemo(
    () =>
      filterDriveVisibleItems({
        files,
        liveSearchResults,
        starredItems,
        sharedItems,
        starred,
        view,
        searchQuery,
        currentUsername,
        operations,
        uploadFiles,
      }),
    [
      currentUsername,
      files,
      liveSearchResults,
      operations,
      searchQuery,
      sharedItems,
      starred,
      starredItems,
      uploadFiles,
      view,
    ],
  );
}
