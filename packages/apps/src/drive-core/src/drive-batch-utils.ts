import {
  apiPathFromUiPath,
  normalizeApiVirtualPath,
  uiPathFromApiPath,
} from "@/lib/files/drive-path-utils";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import { claimDirectoryEntryName } from "@/lib/files/drive-entry-names";
import type { Dispatch, SetStateAction } from "react";
import type { ViewKey } from "@/lib/files/drive-models";

export function resolveDriveFileApiPath(
  file: DriveFile,
  username: string,
  groupRoots: Set<string>,
): string {
  if (file.apiPath) return normalizeApiVirtualPath(file.apiPath);
  const parentApi = apiPathFromUiPath(file.parent, username, groupRoots);
  return normalizeApiVirtualPath(`${parentApi}/${file.title}`);
}

export function applyDriveListing(
  nextData: DriveUIData,
  username: string,
  setFiles: Dispatch<SetStateAction<DriveFile[]>>,
  setView: Dispatch<SetStateAction<ViewKey>>,
) {
  setFiles(nextData.directory.files.map((entry) => driveFileFromEntry(entry, username)));
  setView({ type: "folder", path: uiPathFromApiPath(nextData.cwd, username) });
}

export function mapDriveListingEntries(nextData: DriveUIData, username: string): DriveFile[] {
  return nextData.directory.files.map((entry) => driveFileFromEntry(entry, username));
}

/** Keep optimistically moved items visible when opening a folder before listing refresh catches up. */
export function mergeDriveFolderListing(
  previousFiles: DriveFile[],
  nextData: DriveUIData,
  username: string,
): DriveFile[] {
  const folderPath = uiPathFromApiPath(nextData.cwd, username);
  const serverFiles = mapDriveListingEntries(nextData, username);
  const serverIds = new Set(serverFiles.map((file) => file.id));
  const staged = previousFiles.filter(
    (file) => file.parent === folderPath && !serverIds.has(file.id),
  );
  return [...serverFiles, ...staged];
}

/**
 * A folder fetched again because another user changed it (#1663). Rows the
 * server no longer lists are gone, so they drop, unlike in
 * {@link mergeDriveFolderListing}. Rows the server never listed stay: a new
 * folder still on its way (no `apiPath` yet), and with `keepStaged` every
 * row of the folder, for writes that wait in the outbox.
 */
export function refreshDriveFolderListing(
  previousFiles: DriveFile[],
  nextData: DriveUIData,
  username: string,
  keepStaged: boolean,
): DriveFile[] {
  if (keepStaged) return mergeDriveFolderListing(previousFiles, nextData, username);
  return mergeDriveFolderListing(
    previousFiles.filter((file) => !file.apiPath),
    nextData,
    username,
  );
}

export async function reloadDriveFolderListing(
  operations: DriveAPIOperations,
  folderPath: string,
  username: string,
  groupRoots: Set<string>,
  setFiles: Dispatch<SetStateAction<DriveFile[]>>,
  signal?: AbortSignal,
) {
  const nextData = await operations.changeDir(apiPathFromUiPath(folderPath, username, groupRoots), {
    signal,
  });
  setFiles((previous) => mergeDriveFolderListing(previous, nextData, username));
}

export type RestoredDriveName = { title: string; to: string };

export function restoredDriveNamesMessage(
  restored: readonly RestoredDriveName[],
): string | undefined {
  if (restored.length === 1) {
    const row = restored[0];
    if (!row) return undefined;
    return `Restored “${row.title}” as “${row.to}”`;
  }
  if (restored.length > 1) return `Restored ${restored.length} files under a new name`;
  return undefined;
}

export function unrestoredDriveFilesMessage(count: number): string {
  return `Couldn't restore ${count} file${count === 1 ? "" : "s"}`;
}

export type DriveRestoreMove = {
  id: string;
  title: string;
  from: string;
  previousParent: string;
};

/**
 * Put each completed move back. A listing or rename error is counted and the
 * next file still runs, so one failure does not leave the rest unrestored.
 */
export async function restoreCompletedDriveMoves(input: {
  operations: DriveAPIOperations;
  moves: readonly DriveRestoreMove[];
  completedKeys: ReadonlySet<string>;
  username: string;
  groupRoots: Set<string>;
}): Promise<{
  restored: RestoredDriveName[];
  failures: number;
  /** Final name for every completed file the server put back, including an unchanged title. */
  restoredToById: Map<string, string>;
}> {
  const takenByDirectory = new Map<string, Set<string>>();
  const restored: RestoredDriveName[] = [];
  const restoredToById = new Map<string, string>();
  let failures = 0;
  for (const move of input.moves) {
    if (!input.completedKeys.has(move.id)) continue;
    try {
      const destination = apiPathFromUiPath(move.previousParent, input.username, input.groupRoots);
      const to = await claimDirectoryEntryName(
        input.operations,
        destination,
        move.title,
        takenByDirectory,
      );
      await input.operations.renameItem({ destination, from: move.from, to });
      restoredToById.set(move.id, to);
      if (to !== move.title) restored.push({ title: move.title, to });
    } catch (error) {
      failures += 1;
      console.error("Drive batch restore failed", error);
    }
  }
  return { restored, failures, restoredToById };
}
