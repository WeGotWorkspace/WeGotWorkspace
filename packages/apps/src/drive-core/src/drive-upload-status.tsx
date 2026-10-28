import type { DriveFile } from "@/drive-core/src/drive-models";
import { driveUploadStatusText } from "@/drive-core/src/drive-labels";
import { cn } from "@/lib/utils";

/** Status line of an upload placeholder (grid tile and list row). Nothing for real files. */
export function DriveUploadStatus({ upload }: { upload: DriveFile["upload"] }) {
  if (!upload) return null;
  return (
    <span className={cn("drive-upload-status", `drive-upload-status--${upload.status}`)}>
      {driveUploadStatusText(upload)}
    </span>
  );
}
