import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { DriveOfflinePinButton } from "@/drive-core/src/drive-offline-pin-button";
import { DriveUploadRing } from "@/drive-core/src/drive-upload-ring";

/** A Drive item's offline control, or an upload's progress ring in its place. */
export function DriveFileOfflinePinCell({
  file,
  labels,
  offlineEnabled,
  isOfflineAvailable,
  isOfflinePendingSync,
  isPinning,
  canPinOffline,
  onMakeOfflineAvailable,
}: {
  file: DriveFile;
  labels: DriveUILabels;
  offlineEnabled: boolean;
  isOfflineAvailable: boolean;
  isOfflinePendingSync: boolean;
  isPinning: boolean;
  canPinOffline: boolean;
  onMakeOfflineAvailable?: (file: DriveFile) => void;
}) {
  // An upload placeholder shows its progress in the offline control's slot.
  if (file.upload) return <DriveUploadRing file={file} />;
  if (!offlineEnabled || file.kind === "folder") return null;

  return (
    <DriveOfflinePinButton
      labels={labels}
      isAvailable={isOfflineAvailable}
      isPending={isOfflinePendingSync}
      isPinning={isPinning}
      canPin={canPinOffline}
      onPin={onMakeOfflineAvailable ? () => onMakeOfflineAvailable(file) : undefined}
    />
  );
}
