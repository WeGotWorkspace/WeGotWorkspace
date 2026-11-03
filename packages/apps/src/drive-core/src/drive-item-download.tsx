import { createContext, useContext } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

/**
 * True when the Drive operations can download a folder as a zip (#1621):
 * signed-in sessions. The row menu reads it here, so the flag does not have
 * to travel through every grid and list component.
 */
export const DriveFolderDownloadContext = createContext(false);

/** Whether *Download* (or *Download as zip* on a folder) is offered for this item. */
export function canDownloadDriveItem(
  file: DriveFile,
  options: { foldersDownloadable: boolean; inTrash: boolean },
): boolean {
  if (file.kind !== "folder") return true;
  // The server refuses a folder in trash.
  return options.foldersDownloadable && !options.inTrash;
}

/** `canDownloadDriveItem` with the folder flag from DriveFolderDownloadContext. */
export function useCanDownloadDriveItem(file: DriveFile | null, inTrash: boolean): boolean {
  const foldersDownloadable = useContext(DriveFolderDownloadContext);
  return file ? canDownloadDriveItem(file, { foldersDownloadable, inTrash }) : false;
}

/**
 * Starts the download of a file, or of a folder as a zip. The browser saves
 * it natively; a failure to start reaches `onError` as a message.
 */
export function startDriveItemDownload(
  operations: DriveAPIOperations | undefined,
  file: DriveFile,
  onError: (message: string) => void,
): void {
  if (!operations || !file.apiPath) return;
  const started =
    file.kind === "folder"
      ? operations.downloadFolder?.(file.apiPath)
      : operations.downloadFile(file.apiPath);
  void started?.catch((error: unknown) => {
    onError(error instanceof Error ? error.message : String(error));
  });
}
