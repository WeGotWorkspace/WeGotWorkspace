import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import { canBrowserPreviewImage, inferFileKindFromName } from "@/drive-core/src/drive-file-utils";
import { canMoveDriveItemsToFolder, driveFolderUiPath } from "@/drive-core/src/drive-item-path";
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import { DRIVE_TRASH_UI_PATH } from "@/drive-core/src/drive-path-utils";

const GROUPS_ROOT = "Groups";

/** Move / New-doc vs Insert-image on the shared Drive folder picker. */
export type DrivePickerMode = "folder-destination" | "file-select";

const DRIVE_PICKER_ROOT_FILE_ID_PREFIX = "drive-picker-root:";

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

/**
 * Folders stay (navigate). Files stay only when the name is a browser-previewable
 * image — HEIC and non-images are omitted. Folder-at-a-time; no MIME query.
 */
export function isDriveFileSelectListingEntry(file: DriveFile): boolean {
  if (file.kind === "folder") return true;
  return inferFileKindFromName(file.title) === "image" && canBrowserPreviewImage(file.title);
}

export function drivePickerRootFileId(path: string): string {
  return `${DRIVE_PICKER_ROOT_FILE_ID_PREFIX}${path}`;
}

export function isDrivePickerRootFile(file: Pick<DriveFile, "id">): boolean {
  return file.id.startsWith(DRIVE_PICKER_ROOT_FILE_ID_PREFIX);
}

export function createDrivePickerRootFile(path: string, title: string): DriveFile {
  return {
    id: drivePickerRootFileId(path),
    notebook: "Folder",
    category: "Folder",
    date: "",
    title,
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    parent: DRIVE_FOLDER_PICKER_ROOT,
    kind: "folder",
    size: "",
  };
}

/** Browse path for a file-select tile: synthetic drive root or a real folder. */
export function browsePathForDrivePickerFile(file: DriveFile): string | null {
  if (file.id.startsWith(DRIVE_PICKER_ROOT_FILE_ID_PREFIX)) {
    return file.id.slice(DRIVE_PICKER_ROOT_FILE_ID_PREFIX.length);
  }
  if (file.kind === "folder") return driveFolderUiPath(file);
  return null;
}
