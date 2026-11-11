import type { DriveFile } from "@/lib/files/drive-models";

/** UI path for a folder row (used as a move/drop destination). */
export function driveFolderUiPath(file: DriveFile): string {
  const parent = file.parent.trim();
  if (!parent) return file.title;
  return `${parent}/${file.title}`;
}

export function canMoveDriveItemsToFolder(
  items: DriveFile[],
  ids: string[],
  destinationPath: string,
): string[] {
  const normalizedDest = destinationPath.replace(/\/+$/, "");
  return ids.filter((id) => {
    const item = items.find((file) => file.id === id);
    if (!item) return false;
    if (item.kind === "folder") {
      const folderPath = driveFolderUiPath(item);
      if (normalizedDest === folderPath) return false;
      if (normalizedDest.startsWith(`${folderPath}/`)) return false;
      return true;
    }
    const fileParent = item.parent.replace(/\/+$/, "");
    if (fileParent === normalizedDest) return false;
    return true;
  });
}
