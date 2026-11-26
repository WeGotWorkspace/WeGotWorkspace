import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

/** What the footer *New folder* button needs from the picker it sits beside. */
export type DrivePickerNewFolderControl = {
  /** Why the button is off, or null when a folder can be added where the picker is. */
  disabledReason: string | null;
  /** True while the name field is open in the list. */
  active: boolean;
  /** True while a folder made here is still being created: do not confirm until it is. */
  creating: boolean;
  start: () => void;
};

export const DRIVE_PICKER_NEW_FOLDER_DEFAULT_NAME = "New folder";

/** A free "New folder", "New folder 2", … among the folders already listed. */
export function suggestDrivePickerFolderName(base: string, siblings: DriveFile[]): string {
  const taken = new Set(siblings.map((file) => file.title.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

/**
 * The reason a typed folder name cannot be used, or null when it can.
 * An empty name is not an error here: the caller treats it as "not named yet".
 */
export function drivePickerFolderNameError(
  name: string,
  siblings: DriveFile[],
  labels: Pick<DriveUILabels, "pickerNewFolderExists" | "pickerNewFolderInvalid">,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed === "." || trimmed === "..") {
    return labels.pickerNewFolderInvalid;
  }
  const lower = trimmed.toLowerCase();
  if (siblings.some((file) => file.title.toLowerCase() === lower)) {
    return labels.pickerNewFolderExists(trimmed);
  }
  return null;
}
