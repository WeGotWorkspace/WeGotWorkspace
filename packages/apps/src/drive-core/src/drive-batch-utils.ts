import {
  apiPathFromUiPath,
  DRIVE_TRASH_DIR_NAME,
  normalizeApiVirtualPath,
  uiPathFromApiPath,
} from "@/drive-core/src/drive-path-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import type { Dispatch, SetStateAction } from "react";
import type { ViewKey } from "@/drive-core/src/drive-models";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";

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

function mapDriveListingEntries(nextData: DriveUIData, username: string): DriveFile[] {
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

/** Pick `fileName`, or `name 2.ext`, when that title is already taken. */
export function resolveFreeName(fileName: string, taken: ReadonlySet<string>): string {
  const takenLower = new Set(Array.from(taken, (name) => name.toLowerCase()));
  const dot = fileName.lastIndexOf(".");
  const hasExt = dot > 0;
  const base = hasExt ? fileName.slice(0, dot) : fileName;
  const ext = hasExt ? fileName.slice(dot) : "";

  let candidate = fileName;
  let index = 2;
  while (takenLower.has(candidate.toLowerCase())) {
    candidate = `${base} ${index}${ext}`;
    index += 1;
  }
  return candidate;
}

export async function listDirectoryEntryNames(
  operations: DriveAPIOperations,
  directoryApiPath: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const taken = new Set<string>();
  if (!operations.listAllDirectoryEntries) return taken;
  try {
    const entries = await operations.listAllDirectoryEntries(directoryApiPath, { signal });
    for (const entry of entries) taken.add(entry.name);
  } catch {
    // The folder may not exist yet.
  }
  return taken;
}

export async function listTrashEntryNames(
  operations: DriveAPIOperations,
  trashApiPath: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  return listDirectoryEntryNames(operations, trashApiPath, signal);
}

/**
 * Pick a free name in `directoryApiPath`. `takenByDirectory` caches the listing for later files
 * in the same restore so two siblings do not claim the same title.
 * Offline, or when the listing fails because the network is down, keep `preferredName` so a
 * hybrid rename can queue the restore. Any other listing failure is thrown: an empty set would
 * treat the original title as free.
 */
export async function claimDirectoryEntryName(
  operations: DriveAPIOperations,
  directoryApiPath: string,
  preferredName: string,
  takenByDirectory: Map<string, Set<string>>,
): Promise<string> {
  if (!readBrowserOnline()) return preferredName;

  let taken = takenByDirectory.get(directoryApiPath);
  if (!taken) {
    taken = new Set<string>();
    if (operations.listAllDirectoryEntries) {
      try {
        const entries = await operations.listAllDirectoryEntries(directoryApiPath);
        for (const entry of entries) taken.add(entry.name);
      } catch (error) {
        if (isFetchNetworkError(error)) return preferredName;
        throw error;
      }
    }
    takenByDirectory.set(directoryApiPath, taken);
  }
  const name = resolveFreeName(preferredName, taken);
  taken.add(name);
  return name;
}

export type RestoredDriveName = { id: string; title: string; to: string };

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
  failedIds: string[];
  /** Final name for every completed file the server put back, including an unchanged title. */
  restoredToById: Map<string, string>;
}> {
  const takenByDirectory = new Map<string, Set<string>>();
  const restored: RestoredDriveName[] = [];
  const failedIds: string[] = [];
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
      if (to !== move.title) restored.push({ id: move.id, title: move.title, to });
    } catch (error) {
      failures += 1;
      failedIds.push(move.id);
      console.error("Drive batch restore failed", error);
    }
  }
  return { restored, failures, failedIds, restoredToById };
}

export async function ensureTrashFolder(
  operations: DriveAPIOperations,
  username: string,
  groupRoots: Set<string>,
  signal?: AbortSignal,
) {
  const userRoot = apiPathFromUiPath("My Drive", username, groupRoots);
  if (operations.listAllDirectoryEntries) {
    try {
      const entries = await operations.listAllDirectoryEntries(userRoot, { signal });
      if (entries.some((entry) => entry.name === DRIVE_TRASH_DIR_NAME && entry.type === "dir")) {
        return;
      }
    } catch {
      // fall through to create
    }
  }
  try {
    await operations.createFolder(
      { cwd: userRoot, name: DRIVE_TRASH_DIR_NAME },
      { signal, refreshState: false },
    );
  } catch {
    // Folder may already exist.
  }
}
