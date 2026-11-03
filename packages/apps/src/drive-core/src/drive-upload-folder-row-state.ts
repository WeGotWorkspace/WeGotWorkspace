import { driveLabels } from "@/drive-core/src/drive-labels";
import type {
  DriveUploadLiveState,
  DriveUploadRowKind,
  DriveUploadRowState,
} from "@/drive-core/src/drive-upload-row-state";
import type { DriveUploadFolderView } from "@/lib/offline/drive/upload/drive-upload-subscription";

/**
 * Folder upload (#1620): the row of a folder in the upload. It shows the
 * progress of everything below it ("Uploading · 42% · 2 failed"), and turns
 * failed once nothing below it is still going and something failed.
 */
export function driveUploadFolderRowState(
  folder: DriveUploadFolderView,
  live: Pick<DriveUploadLiveState, "batch" | "queueState"> = {},
): DriveUploadRowState {
  const base = { addAgain: false, notOnDevice: false, canRemove: true };
  const failedNote =
    folder.failedFiles > 0 ? driveLabels.uploadFolderFailed(folder.failedFiles) : undefined;

  if (folder.status === "failed") {
    const reasonText = folder.error ? driveLabels.uploadFailedReason[folder.error.code] : undefined;
    const statusText = [driveLabels.uploadState.failed, reasonText].filter(Boolean).join(" · ");
    return {
      ...base,
      kind: "failed",
      percent: null,
      statusText,
      valueText: statusText,
      ...(reasonText ? { reasonText } : {}),
      ...(folder.error ? { reason: folder.error.code } : {}),
      canRetry: folder.canRetry,
    };
  }

  const going = folder.subtreeFiles - folder.filesDone - folder.failedFiles;
  if (going <= 0 && folder.failedFiles > 0) {
    const statusText = `${driveLabels.uploadState.failed} · ${failedNote}`;
    return {
      ...base,
      kind: "failed",
      percent: null,
      statusText,
      valueText: statusText,
      reasonText: failedNote,
      canRetry: folder.canRetry,
    };
  }

  const percent =
    folder.subtreeBytes > 0
      ? Math.min(100, Math.round((folder.bytesDone / folder.subtreeBytes) * 100))
      : null;
  const waiting = waitingKind(live);
  // A created folder on a running queue is busy with the folders and files below it.
  const started =
    folder.status === "creating" ||
    folder.bytesDone > 0 ||
    folder.filesDone > 0 ||
    (folder.status === "created" && waiting === "waiting");
  const kind: DriveUploadRowKind = started ? "uploading" : waiting;
  const words = driveLabels.uploadState[kind];
  const text = [
    words,
    started && percent !== null ? driveLabels.uploadPercent(percent) : undefined,
    failedNote,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    ...base,
    kind,
    percent: started ? percent : null,
    statusText: text,
    valueText: text,
    canRetry: false,
    // While something below it uploads, *Remove* would pull files mid-way.
    canRemove: !started,
  };
}

function waitingKind({ batch, queueState }: Pick<DriveUploadLiveState, "batch" | "queueState">) {
  if (batch?.status === "awaiting_input") return "waitingForAnswer" as const;
  if (queueState === "paused_offline") return "waitingOffline" as const;
  if (queueState === "paused_server_full") return "waitingServerFull" as const;
  return "waiting" as const;
}
