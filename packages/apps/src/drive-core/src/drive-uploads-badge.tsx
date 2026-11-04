import { CircleAlert, CirclePause } from "lucide-react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { driveUploadIssueLabels } from "@/drive-core/src/drive-upload-issue-labels";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-uploads.css";

/**
 * Count on the Uploads sidebar entry. Turns into an error badge while any
 * file failed, and shows a pause sign while the server is full (#1522), even
 * though a file failed then; screen readers hear "3 files, 1 failed" or "3 files, paused, the server is full".
 */
export function DriveUploadsBadge({
  count,
  failed,
  paused = false,
}: {
  count: number;
  failed: number;
  paused?: boolean;
}) {
  // A full server always leaves a failed file, so the pause wins over the error sign.
  const text = driveLabels.uploadsBadge(count, paused ? 0 : failed);
  return (
    <span className={cn("drive-uploads-badge", failed > 0 && "drive-uploads-badge--error")}>
      <span className="drive-uploads-badge__visual" aria-hidden="true">
        {paused ? (
          <CirclePause className="drive-uploads-badge__icon" />
        ) : failed > 0 ? (
          <CircleAlert className="drive-uploads-badge__icon" />
        ) : null}
        {count}
      </span>
      <span className="sr-only">
        {paused ? `${text}, ${driveUploadIssueLabels.badgePaused}` : text}
      </span>
    </span>
  );
}
