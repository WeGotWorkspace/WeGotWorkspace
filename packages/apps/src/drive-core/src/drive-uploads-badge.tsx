import { CircleAlert } from "lucide-react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { cn } from "@/lib/utils";
import "@/drive-core/src/drive-uploads.css";

/**
 * Count on the Uploads sidebar entry. Turns into an error badge while any
 * file failed; screen readers hear "3 files, 1 failed".
 */
export function DriveUploadsBadge({ count, failed }: { count: number; failed: number }) {
  return (
    <span className={cn("drive-uploads-badge", failed > 0 && "drive-uploads-badge--error")}>
      <span className="drive-uploads-badge__visual" aria-hidden="true">
        {failed > 0 ? <CircleAlert className="drive-uploads-badge__icon" /> : null}
        {count}
      </span>
      <span className="sr-only">{driveLabels.uploadsBadge(count, failed)}</span>
    </span>
  );
}
