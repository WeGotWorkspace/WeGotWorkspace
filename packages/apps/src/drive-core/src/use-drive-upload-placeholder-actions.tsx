import { useCallback } from "react";
import { FolderInput, RotateCcw, X } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { driveLabels } from "@/drive-core/src/drive-labels";
import {
  canChooseDriveUploadFolder,
  driveUploadIssueLabels,
} from "@/drive-core/src/drive-upload-issue-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  driveUploadRowStateFor,
  type DriveUploadQueueModel,
} from "@/drive-core/src/drive-upload-queue";

/**
 * Row actions of an upload placeholder: *Retry* on a failed file that can be
 * retried, *Remove* on a waiting or failed file. The file that is uploading
 * right now has none. A `no_local_copy` file only offers *Remove*. A file
 * whose folder is gone or no longer writable also offers *Choose another
 * folder* (#1522).
 */
export function useDriveUploadPlaceholderActions(
  model: DriveUploadQueueModel | null,
): (file: DriveFile) => ActionBarAction[] {
  return useCallback(
    (file: DriveFile): ActionBarAction[] => {
      const upload = file.upload;
      if (!upload || !model) return [];
      const state = driveUploadRowStateFor(upload, model);
      const actions: ActionBarAction[] = [];
      if (state.canRetry && model.retry) {
        const retry = model.retry;
        actions.push({
          id: "upload-retry",
          label: driveLabels.uploadRetry,
          icon: <RotateCcw />,
          onClick: () => retry(upload.id),
        });
      }
      if (
        state.kind === "failed" &&
        canChooseDriveUploadFolder(state.reason) &&
        // A folder of a folder upload stays where it is (#1620).
        !model.folderById.has(upload.id) &&
        model.chooseFolder
      ) {
        const chooseFolder = model.chooseFolder;
        actions.push({
          id: "upload-choose-folder",
          label: driveUploadIssueLabels.chooseFolder,
          icon: <FolderInput />,
          onClick: () => chooseFolder(upload.id),
        });
      }
      if (state.canRemove && model.remove) {
        const remove = model.remove;
        actions.push({
          id: "upload-remove",
          label: driveLabels.uploadRemove,
          icon: <X />,
          severity: "danger",
          onClick: () => remove(upload.id),
        });
      }
      return actions;
    },
    [model],
  );
}
