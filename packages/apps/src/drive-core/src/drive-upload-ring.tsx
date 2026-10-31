import { CircleAlert, CircleHelp, CloudOff } from "lucide-react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { useDriveUploadRowState } from "@/drive-core/src/drive-upload-queue";
import type { DriveUploadRowState } from "@/drive-core/src/drive-upload-row-state";
import { ProgressRing } from "@/ui/progress";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-uploads.css";

const RING_LOOK = {
  waiting: "static",
  waitingOffline: "static",
  waitingForAnswer: "static",
  uploading: "spin",
  assembling: "pulse",
} as const;

/** Progress ring (or failed mark) of one upload, by row state. */
export function DriveUploadRingView({
  fileName,
  state,
}: {
  fileName: string;
  state: DriveUploadRowState;
}) {
  if (state.kind === "failed") {
    return (
      <span
        className="drive-upload-ring drive-upload-ring--failed"
        role="img"
        aria-label={`${fileName}: ${state.statusText}`}
        title={state.statusText}
      >
        <CircleAlert className="drive-upload-ring__failed-icon" aria-hidden="true" />
      </span>
    );
  }
  const glyph =
    state.kind === "waitingOffline" ? (
      <CloudOff aria-hidden="true" />
    ) : state.kind === "waitingForAnswer" ? (
      <CircleHelp aria-hidden="true" />
    ) : null;
  return (
    <span
      className={cn("drive-upload-ring", `drive-upload-ring--${state.kind}`)}
      title={state.notOnDevice ? driveLabels.uploadNotOnDeviceDetail : state.statusText}
    >
      <ProgressRing
        value={state.percent}
        label={driveLabels.uploadRingName(fileName)}
        valueText={state.valueText}
        indeterminate={RING_LOOK[state.kind]}
      >
        {glyph}
      </ProgressRing>
    </span>
  );
}

/**
 * The offline control's slot on an upload placeholder (list column, grid
 * actions row): the ring instead of "Make available offline".
 */
export function DriveUploadRing({ file }: { file: DriveFile }) {
  const state = useDriveUploadRowState(file);
  if (!state) return null;
  return <DriveUploadRingView fileName={file.title} state={state} />;
}
