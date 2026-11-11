import type { DriveFile } from "@/lib/files/drive-models";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { useDriveUploadRowState } from "@/drive-core/src/drive-upload-queue";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-uploads.css";

const UPLOADING_PREFIX = `${driveLabels.uploadState.uploading} · `;

/**
 * Status line of an upload placeholder (grid tile and list row). Nothing for
 * real files. While uploading, a phone shows only the percentage.
 */
export function DriveUploadStatus({ file }: { file: DriveFile }) {
  const state = useDriveUploadRowState(file);
  if (!state) return null;
  return (
    <span
      className={cn("drive-upload-status", `drive-upload-status--${state.kind}`)}
      title={state.notOnDevice ? driveLabels.uploadNotOnDeviceDetail : state.statusText}
    >
      {state.kind === "uploading" && state.percent !== null ? (
        <>
          {/* On a phone the percentage alone says enough. */}
          <span className="drive-upload-status__words">{UPLOADING_PREFIX}</span>
          {/* The percentage, then any note: not on this device, files that failed (#1620). */}
          {state.statusText.slice(UPLOADING_PREFIX.length)}
        </>
      ) : (
        state.statusText
      )}
    </span>
  );
}
