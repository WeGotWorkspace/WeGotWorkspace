import type { ReactNode } from "react";
import { Folder, Globe2, HardDrive, Share, Share2, Users2 } from "lucide-react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { kindIcon } from "@/drive-core/src/drive-icons";
import { driveLabels, type DriveUILabels } from "@/drive-core/src/drive-labels";
import { isDrivePickerRootFile } from "@/drive-core/src/drive-folder-picker-utils";
import { SHARED_WITH_ME_UI_ROOT } from "@/drive-core/src/drive-path-utils";
import { cn } from "@/lib/utils";

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

export function DriveFileKindIcon({
  file,
  listStyle = false,
}: {
  file: DriveFile;
  listStyle?: boolean;
}) {
  if (isDrivePickerRootFile(file)) {
    return (
      <span className={cn("shrink-0 [&>svg]:size-4", listStyle && "drive-list-folder-icon")}>
        <HardDrive className="size-4" />
      </span>
    );
  }

  if (file.kind === "folder") {
    return (
      <span className={cn("shrink-0 [&>svg]:size-4", listStyle && "drive-list-folder-icon")}>
        <Folder className="size-4" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "shrink-0",
        listStyle ? "drive-list-file-icon [&>svg]:size-4" : "drive-file-tile__kind-icon",
      )}
    >
      {kindIcon[file.kind]}
    </span>
  );
}
