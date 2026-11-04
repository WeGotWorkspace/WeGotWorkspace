import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { driveUploadBatchLabels as L } from "@/drive-core/src/drive-upload-batch-labels";
import type { DriveUploadNotice } from "@/lib/offline/drive/upload/drive-upload-schema";
import type { DriveUploadBatchView } from "@/lib/offline/drive/upload/drive-upload-subscription";
import "@/drive-core/src/drive-uploads.css";

export function driveUploadNoticeText(notice: DriveUploadNotice): string {
  switch (notice.type) {
    case "replace_fell_back":
      return L.noticeReplaceFellBack(notice.itemName, notice.keptAsName);
    case "kept_both":
      return L.noticeKeptBoth(notice.itemName, notice.keptAsName);
    case "offline_copy_failed":
      return L.noticeOfflineCopyFailed(notice.itemName);
  }
}

/**
 * Batch notices (#1519), e.g. a *Replace* that kept both because the file
 * changed in the meantime. They stay, in every tab and after a reload, until
 * the user presses OK on the batch's notices.
 */
export function DriveUploadNotices({
  batches,
  onDismiss,
}: {
  batches: readonly Pick<DriveUploadBatchView, "id" | "notices">[];
  onDismiss: (batchId: string) => void;
}) {
  const withNotices = batches.filter((batch) => batch.notices.length > 0);
  if (withNotices.length === 0) return null;
  return (
    <section className="drive-upload-notices" aria-label={L.noticesRegion}>
      {withNotices.map((batch) => (
        <Callout
          key={batch.id}
          className="drive-upload-notices__notice"
          severity="info"
          title={
            batch.notices.length === 1 ? (
              driveUploadNoticeText(batch.notices[0]!)
            ) : (
              <ul className="drive-upload-notices__list">
                {batch.notices.map((notice, index) => (
                  <li key={index}>{driveUploadNoticeText(notice)}</li>
                ))}
              </ul>
            )
          }
          action={
            <Button variant="outline" size="md" onClick={() => onDismiss(batch.id)}>
              {L.noticeDismiss}
            </Button>
          }
        />
      ))}
    </section>
  );
}
