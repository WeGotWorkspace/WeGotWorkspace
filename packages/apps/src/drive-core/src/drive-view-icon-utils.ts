import type { LucideIcon } from "lucide-react";
import { Clock, HardDrive, Share2, Shield, Star, Trash2 } from "lucide-react";
import { isDriveSharedGroupPath } from "@/drive-core/src/drive-breadcrumbs";
import type { ViewKey } from "@/drive-core/src/drive-models";

/** Icons aligned with {@link useDriveSidebarModel} sidebar items. */
export const driveViewIcons = {
  myDrive: HardDrive,
  sharedWithMe: Share2,
  recent: Clock,
  starred: Star,
  trash: Trash2,
  groupDrive: HardDrive,
  access: Shield,
} as const satisfies Record<string, LucideIcon>;

export function resolveDriveViewIcon(view: ViewKey): LucideIcon {
  if (view.type === "access") return driveViewIcons.access;
  if (view.type === "recent") return driveViewIcons.recent;
  if (view.type === "starred") return driveViewIcons.starred;
  if (view.type === "shared") return driveViewIcons.sharedWithMe;

  if (view.path === "Trash" || view.path.startsWith("Trash/")) return driveViewIcons.trash;
  if (isDriveSharedGroupPath(view.path)) return driveViewIcons.groupDrive;
  return driveViewIcons.myDrive;
}
