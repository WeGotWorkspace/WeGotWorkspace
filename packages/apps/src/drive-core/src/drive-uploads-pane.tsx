import { useEffect, useState } from "react";
import { CircleCheck, FolderOpen, RotateCcw, X } from "lucide-react";
import { Button } from "@/button/src/button";
import { CollectionState } from "@/collection-state/src/collection-state";
import { kindIcon } from "@/drive-core/src/drive-icons";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
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

type LastFolder = { path: string; label: string };

/**
 * The Uploads view: every queued, uploading, and failed file across folders,
 * with its target folder, progress, status, and *Retry* / *Remove*. When the
 * queue empties while the view is open, it says so and links to the folder
 * of the last batch.
 */
export function DriveUploadsPane({ files, searchActive, onOpenFolder }: DriveUploadsPaneProps) {
  const model = useDriveUploadQueueContext();
  const lastFolder = useLastUploadFolder(files);

  // No model yet means the first queue read is still pending, not an empty queue.
  if (!model) return null;

  if (model.snapshot.items.length === 0) {
    return (
      <CollectionState icon={<CircleCheck className="size-12" />}>
        <p>{driveLabels.uploadsAllDone}</p>
        {lastFolder ? (
          <Button
            className="drive-uploads__done-link"
            variant="secondary"
            size="sm"
            onClick={() => onOpenFolder(lastFolder.path)}
          >
            <FolderOpen className="size-4" aria-hidden="true" />
            {driveLabels.uploadsGoToFolder(lastFolder.label)}
          </Button>
        ) : null}
      </CollectionState>
    );
  }

  return (
    <section className="drive-uploads" aria-labelledby="drive-uploads-summary">
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
        <span className={cn("drive-upload-status", `drive-upload-status--${state.kind}`)}>
          {state.statusText}
        </span>
        {state.notOnDevice ? (
          <span className="drive-uploads__note">{driveLabels.uploadNotOnDeviceDetail}</span>
        ) : null}
      </div>
      <DriveUploadRingView fileName={file.title} state={state} />
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

/** Folder of the newest file seen while the queue had files; kept once it empties. */
function useLastUploadFolder(files: readonly DriveFile[]): LastFolder | null {
  const [last, setLast] = useState<LastFolder | null>(null);
  const newest = files[files.length - 1];
  const path = newest?.parent;
  const label = newest?.location;
  useEffect(() => {
    if (path && label) setLast({ path, label });
  }, [label, path]);
  return last;
}
