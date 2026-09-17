import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import { canMoveDriveItemsToFolder } from "@/drive-core/src/drive-item-path";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import { DRIVE_TRASH_UI_PATH } from "@/drive-core/src/drive-path-utils";

const GROUPS_ROOT = "Groups";

function isTrashPath(path: string) {
  return path === DRIVE_TRASH_UI_PATH || path.startsWith(`${DRIVE_TRASH_UI_PATH}/`);
}

export function resolveDriveFolderPickerStartPath(
  view: ViewKey,
  singleItemParent?: string,
): string {
  if (view.type === "folder" && !isTrashPath(view.path)) return view.path;
  if (singleItemParent && !isTrashPath(singleItemParent)) return singleItemParent;
  return "My Drive";
}

/**
 * Concrete folder destinations in the move/create picker (not the virtual
 * "Drives" root or the Groups index).
 */
export function isDriveFolderPickerDestinationPath(path: string): boolean {
  const normalized = path.trim().replace(/\/+$/, "");
  if (!normalized || normalized === DRIVE_FOLDER_PICKER_ROOT) return false;
  if (normalized === GROUPS_ROOT) return false;
  if (isTrashPath(normalized)) return false;
  return true;
}

/**
 * Whether `destinationPath` can be chosen in the folder picker.
 * Create flows pass `moveIds: []` — those still need drive/folder roots
 * selectable and pre-highlightable (move validation does not apply).
 */
export function canPickDriveFolderDestination(
  items: DriveFile[],
  moveIds: string[],
  destinationPath: string,
): boolean {
  if (!isDriveFolderPickerDestinationPath(destinationPath)) return false;
  if (moveIds.length === 0) return true;
  return canMoveDriveItemsToFolder(items, moveIds, destinationPath).length > 0;
}
