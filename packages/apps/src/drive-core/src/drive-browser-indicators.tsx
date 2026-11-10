import type { ReactNode } from "react";
import { Globe2, HardDrive, Share, Share2, Users2 } from "lucide-react";
import type { DriveFile } from "@/lib/files/drive-models";
import { driveLabels, type DriveUILabels } from "@/drive-core/src/drive-labels";
import { SHARED_WITH_ME_UI_ROOT } from "@/lib/files/drive-path-utils";
import { formatDriveModified } from "@/drive-core/src/drive-list-sort";

/** Share for inbound Shared with me / “Shared by …”; HardDrive for personal + group drives. */
function isSharedByLocation(file: DriveFile): boolean {
  if (file.parent === SHARED_WITH_ME_UI_ROOT) return true;
  const location = file.location?.trim();
  if (!location) return false;
  if (location === driveLabels.sidebarSharedWithMe) return true;
  // driveLabels.sharedBy("") → "Shared by "
  return location.startsWith(driveLabels.sharedBy(""));
}

export function DriveLocationLabel({ file }: { file: DriveFile }) {
  if (!file.location) return <>—</>;
  const sharedBy = isSharedByLocation(file);
  // Personal + group drives share HardDrive (matches sidebar / resolveDriveViewIcon SST).
  const Icon = sharedBy ? Share : HardDrive;
  return (
    <span className="drive-location-label">
      <Icon className="drive-location-label__icon" aria-hidden />
      <span className="drive-location-label__text">{file.location}</span>
    </span>
  );
}

/**
 * A grid tile's details on one line: size and when it last changed. Empty
 * segments drop out. The drive is left out; a tile has no room for it.
 */
export function DriveTileMeta({ file }: { file: DriveFile }) {
  const size = file.kind === "folder" ? "" : file.size.trim();
  const modified = formatDriveModified(file).trim();
  if (!size && !modified) return null;
  return (
    <span className="drive-tile-meta">
      {size ? <span className="drive-tile-meta__segment tabular-nums">{size}</span> : null}
      {modified ? <span className="drive-tile-meta__segment tabular-nums">{modified}</span> : null}
    </span>
  );
}

function DriveShareIndicatorIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="drive-shared-indicator" title={label} role="img" aria-label={label}>
      {children}
    </span>
  );
}

export function DriveShareIndicators({
  file,
  labels,
  showLabel = false,
}: {
  file: DriveFile;
  labels: DriveUILabels;
  showLabel?: boolean;
}) {
  const hasPublic = file.hasPublicShare === true;
  const hasTeam = file.hasTeamShare === true;
  const legacyShared = file.isShared === true && !hasPublic && !hasTeam;

  if (!hasPublic && !hasTeam && !legacyShared) return null;

  if (showLabel && legacyShared) {
    return (
      <span className="drive-shared-indicator" title={labels.sharedIndicator}>
        <Share2 className="drive-shared-indicator__icon" aria-hidden />
        <span className="drive-shared-indicator__label">{labels.sharedIndicator}</span>
      </span>
    );
  }

  return (
    <span className="drive-share-indicators inline-flex items-center gap-1 shrink-0">
      {hasPublic ? (
        <DriveShareIndicatorIcon label={labels.publicShareIndicator}>
          <Globe2 className="drive-shared-indicator__icon" aria-hidden />
        </DriveShareIndicatorIcon>
      ) : null}
      {hasTeam ? (
        <DriveShareIndicatorIcon label={labels.teamShareIndicator}>
          <Users2 className="drive-shared-indicator__icon" aria-hidden />
        </DriveShareIndicatorIcon>
      ) : null}
      {legacyShared ? (
        <DriveShareIndicatorIcon label={labels.sharedIndicator}>
          <Share2 className="drive-shared-indicator__icon" aria-hidden />
        </DriveShareIndicatorIcon>
      ) : null}
    </span>
  );
}
