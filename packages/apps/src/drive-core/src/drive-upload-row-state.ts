import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type {
  DriveUploadBatchView,
  DriveUploadItemView,
  DriveUploadQueueState,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

export type DriveUploadRowKind =
  | "waiting"
  | "waitingOffline"
  | "waitingForAnswer"
  | "waitingServerFull"
  | "uploading"
  | "assembling"
  | "failed";

/** Everything a placeholder row, its ring, and the Uploads view show for one file. */
export type DriveUploadRowState = {
  kind: DriveUploadRowKind;
  /** 0–100 while the uploader reports bytes; `null` = indeterminate. */
  percent: number | null;
  /** Visible status line, e.g. "Uploading · 42%" or "Upload failed · Too large to upload". */
  statusText: string;
  /** What the ring says to a screen reader. */
  valueText: string;
  /** Failed only: the reason in words. */
  reasonText?: string;
  /** Failed with `no_local_copy` or `quota`: only *Remove* applies. */
  addAgain: boolean;
  canRetry: boolean;
  /** *Remove* applies to waiting and failed files, never to the one uploading. */
  canRemove: boolean;
  /** Uploading straight from this tab's memory (device storage fallback). */
  notOnDevice: boolean;
};

export type DriveUploadLiveState = {
  item?: DriveUploadItemView;
  batch?: DriveUploadBatchView;
  queueState?: DriveUploadQueueState;
};

const ADD_AGAIN_REASONS = new Set(["no_local_copy", "quota"]);

/**
 * Percent of a file sent so far, or null while it is unknown. A whole-file
 * upload (and a file small enough for one request after #1519) reports bytes
 * only when it is done, so its ring stays indeterminate on purpose.
 */
export function driveUploadPercent(item?: Pick<DriveUploadItemView, "bytesDone" | "bytesTotal">) {
  if (!item || item.bytesDone <= 0 || item.bytesTotal <= 0) return null;
  return Math.min(100, Math.round((item.bytesDone / item.bytesTotal) * 100));
}

/**
 * State of one upload placeholder. `marker` is what the cached row says; the
 * live queue (when there is one) adds progress, the batch dialog, offline,
 * and the device storage fallback.
 */
export function driveUploadRowState(
  marker: NonNullable<DriveFile["upload"]>,
  live: DriveUploadLiveState = {},
): DriveUploadRowState {
  const { item, batch, queueState } = live;
  const status = item?.status ?? marker.status;
  const notOnDevice = Boolean(item && !item.localCopy && status !== "failed");
  const base = { addAgain: false, notOnDevice, canRetry: false, canRemove: status !== "uploading" };

  if (status === "failed") {
    const reason = item?.error?.code ?? marker.reason;
    const reasonText = reason ? driveLabels.uploadFailedReason[reason] : undefined;
    const addAgain = reason ? ADD_AGAIN_REASONS.has(reason) : false;
    const parts = [
      driveLabels.uploadState.failed,
      reasonText,
      addAgain && driveLabels.uploadAddAgain,
    ];
    const statusText = parts.filter(Boolean).join(" · ");
    return {
      ...base,
      kind: "failed",
      percent: null,
      statusText,
      valueText: statusText,
      ...(reasonText ? { reasonText } : {}),
      addAgain,
      canRetry: item ? item.canRetry : !addAgain,
    };
  }

  if (status === "uploading") {
    if (item?.phase === "assembling") {
      // Its own progress, so the ring does not sit at 100% while the server works.
      const percent = driveUploadPercent({
        bytesDone: item.assembledBytes ?? 0,
        bytesTotal: item.bytesTotal,
      });
      const words = driveLabels.uploadState.assembling;
      const text = percent === null ? words : `${words} · ${driveLabels.uploadPercent(percent)}`;
      return withDeviceNote({ ...base, kind: "assembling", percent }, text);
    }
    const percent = driveUploadPercent(item);
    const words = driveLabels.uploadState.uploading;
    const text = percent === null ? words : `${words} · ${driveLabels.uploadPercent(percent)}`;
    return withDeviceNote({ ...base, kind: "uploading", percent }, text);
  }

  const kind: DriveUploadRowKind =
    batch?.status === "awaiting_input"
      ? "waitingForAnswer"
      : queueState === "paused_offline"
        ? "waitingOffline"
        : queueState === "paused_server_full"
          ? "waitingServerFull"
          : "waiting";
  return withDeviceNote({ ...base, kind, percent: null }, driveLabels.uploadState[kind]);
}

function withDeviceNote(
  state: Omit<DriveUploadRowState, "statusText" | "valueText">,
  text: string,
): DriveUploadRowState {
  if (!state.notOnDevice) return { ...state, statusText: text, valueText: text };
  return {
    ...state,
    statusText: `${text} · ${driveLabels.uploadNotOnDevice}`,
    valueText: `${text}. ${driveLabels.uploadNotOnDeviceDetail}`,
  };
}
