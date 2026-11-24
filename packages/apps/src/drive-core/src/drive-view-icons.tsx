import { FolderKanban } from "lucide-react";
import { isDriveRootPath } from "@/drive-core/src/drive-breadcrumbs";
import { resolveDriveViewIcon } from "@/drive-core/src/drive-view-icon-utils";
import type { ViewKey } from "@/lib/files/drive-models";
import type { PathBreadcrumbItem } from "@/path-breadcrumb/src/path-breadcrumb";

export function DriveViewIcon({
  view,
  className = "size-3.5",
}: {
  view: ViewKey;
  className?: string;
}) {
  const Icon = resolveDriveViewIcon(view);
  return <Icon className={className} aria-hidden />;
}

/** Breadcrumbs whose drive levels show the drive's icon (in the full-path menu). */
export function withDriveRootIcons(
  items: PathBreadcrumbItem[],
  isProjectFolderPath?: (uiPath: string) => boolean,
): PathBreadcrumbItem[] {
  return items.map((item) =>
    isProjectFolderPath?.(item.path ?? "")
      ? { ...item, icon: <FolderKanban className="size-3.5" aria-hidden /> }
      : isDriveRootPath(item.path)
        ? {
            ...item,
            // The picker's list of drives has no view of its own: it shows My Drive's icon.
            icon: <DriveViewIcon view={{ type: "folder", path: item.path || "My Drive" }} />,
          }
        : item,
  );
}
