import { CircleCheck, CirclePause, FolderInput, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";
import { Button, buttonVariants } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { CollectionState } from "@/collection-state/src/collection-state";
import { kindIcon } from "@/drive-core/src/drive-icons";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  canChooseDriveUploadFolder,
  driveUploadIssueLabels as issueLabels,
  driveUploadReasonDetail,
} from "@/drive-core/src/drive-upload-issue-labels";
import { DriveUploadRingView } from "@/drive-core/src/drive-upload-ring";
import {
  driveUploadRowStateFor,
  useDriveUploadQueueContext,
  type DriveUploadQueueModel,
} from "@/drive-core/src/drive-upload-queue";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-uploads.css";

type DriveUploadsPaneProps = {
  /** Upload files of the view (see `driveFilesFromUploadQueue`), search applied. */
  files: DriveFile[];
  searchActive: boolean;
  onOpenFolder: (uiPath: string) => void;
};

/**
 * The Uploads view: every queued, uploading, and failed file across folders,
 * with its target folder, progress, status, and *Retry* / *Remove*. When the
 * queue empties while the view is open, it says so. Each row links to its own
 * folder; there is no single "last folder", since batches go to many folders.
 * A queue paused on a full server says so on top, with *Retry* (#1522).
 */
export function DriveUploadsPane({ files, searchActive, onOpenFolder }: DriveUploadsPaneProps) {
  const model = useDriveUploadQueueContext();

  // No model yet means the first queue read is still pending, not an empty queue.
  if (!model) return null;

  if (model.snapshot.items.length === 0) {
    return (
      <CollectionState icon={<CircleCheck className="size-12" />}>
        <p>{driveLabels.uploadsAllDone}</p>
      </CollectionState>
    );
  }

  const paused = model.snapshot.state === "paused_server_full";
  return (
    <section className="drive-uploads" aria-labelledby="drive-uploads-summary">
      {paused ? (
        <Callout
          className="drive-uploads__paused"
          severity="warning"
          icon={<CirclePause className="callout__icon" aria-hidden />}
          title={issueLabels.serverFullTitle}
          message={issueLabels.serverFullMessage}
          action={
            model.resume ? (
              <Button variant="secondary" size="sm" onClick={model.resume}>
                <RotateCcw className="size-4" aria-hidden="true" />
                {issueLabels.serverFullRetry}
              </Button>
            ) : null
          }
        />
      ) : null}
      <div className="drive-uploads__header">
        <p id="drive-uploads-summary" className="drive-uploads__summary">
          {driveLabels.uploadsSummary(model.snapshot.items.length, model.failedCount)}
        </p>
        {model.retryableCount > 0 && model.retryAllFailed ? (
          <Button variant="secondary" size="sm" onClick={model.retryAllFailed}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {driveLabels.uploadRetryAll}
          </Button>
        ) : null}
      </div>
      {files.length === 0 && searchActive ? (
        <CollectionState>{driveLabels.uploadsNoMatch}</CollectionState>
      ) : (
        <ul className="drive-uploads__list">
          {files.map((file) => (
            <DriveUploadsRow key={file.id} file={file} model={model} onOpenFolder={onOpenFolder} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DriveUploadsRow({
  file,
  model,
  onOpenFolder,
}: {
  file: DriveFile;
  model: DriveUploadQueueModel;
  onOpenFolder: (uiPath: string) => void;
}) {
  if (!file.upload) return null;
  const itemId = file.upload.id;
  const state = driveUploadRowStateFor(file.upload, model);
  const reasonDetail = state.kind === "failed" ? driveUploadReasonDetail(state.reason) : null;
  return (
    <li className={cn("drive-uploads__row", `drive-uploads__row--${state.kind}`)}>
      <span className="drive-uploads__kind" aria-hidden="true">
        {kindIcon[file.kind]}
      </span>
      <div className="drive-uploads__text">
        <span className="drive-uploads__name">{file.title}</span>
        <span className="drive-uploads__meta">
          {file.location ? (
            <button
              type="button"
              className="drive-uploads__folder"
              aria-label={driveLabels.uploadsTargetFolder(file.location)}
              onClick={() => onOpenFolder(file.parent)}
            >
              {file.location}
            </button>
          ) : null}
          <span className="drive-uploads__size">{file.size}</span>
        </span>
        {/* A failed row, and an uploading row once it has a percentage, say it beside the ring. */}
        {(state.kind === "uploading" && state.percent !== null) ||
        state.kind === "failed" ? null : (
          <span className={cn("drive-upload-status", `drive-upload-status--${state.kind}`)}>
            {state.statusText}
          </span>
        )}
        {state.kind === "failed" && state.addAgain ? (
          <span className="drive-uploads__note">{driveLabels.uploadAddAgain}</span>
        ) : null}
        {state.notOnDevice ? (
          <span className="drive-uploads__note">{driveLabels.uploadNotOnDeviceDetail}</span>
        ) : null}
        {reasonDetail ? <span className="drive-uploads__note">{reasonDetail}</span> : null}
        {state.kind === "failed" && state.reason === "insecure_context" ? (
          <DriveUploadAdminLink />
        ) : null}
      </div>
      <div className="drive-uploads__progress">
        {/* The ring tells screen readers the same. */}
        {state.kind === "uploading" && state.percent !== null ? (
          <span className="drive-uploads__percent" aria-hidden="true">
            {driveLabels.uploadPercent(state.percent)}
          </span>
        ) : null}
        {state.kind === "failed" ? (
          <span className="drive-uploads__reason" aria-hidden="true">
            {state.reasonText ?? driveLabels.uploadState.failed}
          </span>
        ) : null}
        <DriveUploadRingView fileName={file.title} state={state} />
      </div>
      <div className="drive-uploads__actions">
        {state.canRetry && model.retry ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${driveLabels.uploadRetry} ${file.title}`}
            onClick={() => model.retry?.(itemId)}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {driveLabels.uploadRetry}
          </Button>
        ) : null}
        {state.kind === "failed" &&
        canChooseDriveUploadFolder(state.reason) &&
        model.chooseFolder ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${issueLabels.chooseFolder}: ${file.title}`}
            onClick={() => model.chooseFolder?.(itemId)}
          >
            <FolderInput className="size-4" aria-hidden="true" />
            {issueLabels.chooseFolder}
          </Button>
        ) : null}
        {state.canRemove && model.remove ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${driveLabels.uploadRemove} ${file.title}`}
            onClick={() => model.remove?.(itemId)}
          >
            <X className="size-4" aria-hidden="true" />
            {driveLabels.uploadRemove}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Only administrators see the way to the https notice in Admin (#1526). */
function DriveUploadAdminLink() {
  const showAdmin = useShowAdminApp();
  if (!showAdmin) return null;
  return (
    <a
      href="/admin"
      className={cn(buttonVariants({ variant: "link", size: "sm" }), "drive-uploads__admin")}
    >
      <ShieldAlert className="size-4" aria-hidden="true" />
      {issueLabels.openAdmin}
    </a>
  );
}
