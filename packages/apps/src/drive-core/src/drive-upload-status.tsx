import type { DriveFile } from "@/drive-core/src/drive-models";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { useDriveUploadRowState } from "@/drive-core/src/drive-upload-queue";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-uploads.css";

/** Status line of an upload placeholder (grid tile and list row). Nothing for real files. */
export function DriveUploadStatus({ file }: { file: DriveFile }) {
  const state = useDriveUploadRowState(file);
  if (!state) return null;
  return (
    <span
      className={cn("drive-upload-status", `drive-upload-status--${state.kind}`)}
      title={state.notOnDevice ? driveLabels.uploadNotOnDeviceDetail : state.statusText}
    >
      {state.statusText}
    </span>
  );
}
