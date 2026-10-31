import { useCallback } from "react";
import { RotateCcw, X } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  driveUploadRowStateFor,
  type DriveUploadQueueModel,
} from "@/drive-core/src/drive-upload-queue";

/**
 * Row actions of an upload placeholder: *Retry* on a failed file that can be
 * retried, *Remove* on a waiting or failed file. The file that is uploading
 * right now has none. A `no_local_copy` file only offers *Remove*.
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
