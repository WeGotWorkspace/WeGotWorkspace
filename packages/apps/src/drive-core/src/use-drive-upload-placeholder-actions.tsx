import { useCallback } from "react";
import { X } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { useAppToast } from "@/hooks/use-app-toast";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

/**
 * Row actions of an upload placeholder: *Cancel upload* while it waits,
 * *Remove* once it failed. A file that is uploading right now has none.
 */
export function useDriveUploadPlaceholderActions(
  operations: Pick<DriveAPIOperations, "removeQueuedUpload"> | undefined,
): (file: DriveFile) => ActionBarAction[] {
  const { showError } = useAppToast();
  const removeQueuedUpload = operations?.removeQueuedUpload;
  return useCallback(
    (file: DriveFile): ActionBarAction[] => {
      const upload = file.upload;
      if (!upload || upload.status === "uploading" || !removeQueuedUpload) return [];
      return [
        {
          id: "upload-remove",
          label:
            upload.status === "failed" ? driveLabels.uploadRemoveFailed : driveLabels.uploadCancel,
          icon: <X />,
          severity: "danger",
          onClick: () => {
            void removeQueuedUpload(upload.id).catch((error: unknown) =>
              showError(error instanceof Error ? error.message : String(error)),
            );
          },
        },
      ];
    },
    [removeQueuedUpload, showError],
  );
}
