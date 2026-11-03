import type { DriveUILabels } from "@/drive-core/src/drive-labels";
import { cn } from "@/lib/utils";
import { DriveItemIconButton } from "@/drive-core/src/drive-item-icon-button";
import {
  DriveOfflineAvailableIcon,
  DriveOfflinePinningIcon,
} from "@/drive-core/src/drive-offline-icons";

type DriveOfflinePinButtonProps = {
  labels: DriveUILabels;
  isAvailable: boolean;
  isPending: boolean;
  isPinning: boolean;
  canPin: boolean;
  onPin?: () => void;
};

/** Inline control to pin a file for offline use (list column or grid actions row). */
export function DriveOfflinePinButton({
  labels,
  isAvailable,
  isPending,
  isPinning,
  canPin,
  onPin,
}: DriveOfflinePinButtonProps) {
  if (isAvailable) return null;

  if (isPending || isPinning) {
    return (
      <DriveItemIconButton
        label={labels.offlineDownloading}
        icon={<DriveOfflinePinningIcon className="animate-spin" />}
        disabled
      />
    );
  }

  return (
    <DriveItemIconButton
      label={labels.offlineMakeAvailable}
      icon={<DriveOfflineAvailableIcon />}
      disabled={!canPin || !onPin}
      onClick={() => onPin?.()}
    />
  );
}

export type DriveOfflineBadgeLabels = {
  offlineAvailable: string;
  offlinePendingSync: string;
};

/** Dot next to a file name when offline pins have no column of their own. */
export function DriveOfflineBadge({
  pinned,
  pending,
  labels,
}: {
  pinned: boolean;
  pending: boolean;
  labels?: DriveOfflineBadgeLabels;
}) {
  if (!pinned && !pending) return null;
  const label = pending
    ? (labels?.offlinePendingSync ?? "Pending sync")
    : (labels?.offlineAvailable ?? "Available offline");
  return (
    <span
      className={cn(
        "drive-offline-badge",
        pending && "drive-offline-badge--pending",
        pinned && !pending && "drive-offline-badge--pinned",
      )}
      aria-label={label}
      title={label}
    />
  );
}
