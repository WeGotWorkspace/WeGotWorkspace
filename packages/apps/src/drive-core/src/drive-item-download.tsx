import { createContext, useContext } from "react";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

/**
 * True when the Drive operations can download a folder as a zip (#1621):
 * signed-in sessions. The row menu reads it here, so the flag does not have
 * to travel through every grid and list component.
 */
export const DriveFolderDownloadContext = createContext(false);

/** Whether *Download* (a folder downloads as one zip) is offered for this item. */
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
 * it natively; a failure reaches `onError`. `onStarted` runs at once for a
 * file (a guest's file loads before it saves), and for a folder only once the
 * browser has the zip, so an offline refusal shows only its error.
 */
export function startDriveItemDownload(
  operations: DriveAPIOperations | undefined,
  file: DriveFile,
  onError: (message: string) => void,
  onStarted?: () => void,
): void {
  if (!operations || !file.apiPath) return;
  const started =
    file.kind === "folder"
      ? operations.downloadFolder?.(file.apiPath)
      : operations.downloadFile(file.apiPath);
  if (file.kind !== "folder") onStarted?.();
  void started?.then(
    () => {
      if (file.kind === "folder") onStarted?.();
    },
    (error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    },
  );
}

/**
 * Whether *Download* (one zip, #1905) is offered for several selected items:
 * two or more, outside trash, where the operations can zip a selection, each
 * with an API path.
 */
export function canDownloadDriveSelection(
  selected: readonly (DriveFile | undefined)[],
  options: { selectionDownloadable: boolean; inTrash: boolean },
): selected is readonly DriveFile[] {
  return (
    selected.length >= 2 &&
    options.selectionDownloadable &&
    !options.inTrash &&
    selected.every((file) => !!file?.apiPath)
  );
}

/**
 * Starts the download of several selected items as one zip named after
 * `zipName`. Like a folder, `onStarted` runs once the browser has the zip, so
 * an offline refusal shows only its error.
 */
export function startDriveSelectionDownload(
  operations: DriveAPIOperations | undefined,
  files: readonly DriveFile[],
  zipName: string,
  onError: (message: string) => void,
  onStarted?: () => void,
): void {
  const paths = files.flatMap((file) => (file.apiPath ? [file.apiPath] : []));
  void operations?.downloadSelection?.(paths, zipName).then(
    () => onStarted?.(),
    (error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    },
  );
}
