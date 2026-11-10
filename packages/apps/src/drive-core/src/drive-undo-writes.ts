import { resolveDriveFileApiPath, type DriveRestoreMove } from "@/drive-core/src/drive-batch-utils";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  resolveFreeName,
} from "@/lib/files/drive-entry-names";
import { apiPathFromUiPath, DRIVE_TRASH_UI_PATH } from "@/lib/files/drive-path-utils";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";

/** A star value a path had before a change, for Undo. */
export type DriveStarChange = { path: string; before: boolean };

/** Undo of a star change: each path gets its old value back (a delta, one path at a time). */
export async function restoreDriveStars(
  operations: Pick<DriveAPIOperations, "setStar">,
  changes: readonly DriveStarChange[],
): Promise<void> {
  await Promise.all(
    changes.map(({ path, before }) => operations.setStar({ path, starred: before })),
  );
}

type DriveRowsTarget = {
  operations: DriveAPIOperations;
  username: string;
  groupRoots: Set<string>;
};

/**
 * Moves own files into Trash one at a time and hard-deletes items shared with you (they
 * cannot go into your Trash). `stop` is only checked between files; renames never get it.
 */
export async function trashDriveRows(
  { operations, username, groupRoots }: DriveRowsTarget,
  input: {
    ownRows: readonly DriveFile[];
    foreignRows: readonly DriveFile[];
    trashedNameById: Map<string, string>;
    stop: AbortSignal;
    markCompleted: (id: string) => void;
  },
): Promise<void> {
  const { ownRows, foreignRows, trashedNameById, stop, markCompleted } = input;
  if (ownRows.length > 0) {
    await ensureTrashFolder(operations, username, groupRoots, stop);
    const destination = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, username, groupRoots);
    const trashNames = await listTrashEntryNames(operations, destination, stop);
    for (const file of ownRows) {
      stop.throwIfAborted();
      const from = resolveDriveFileApiPath(file, username, groupRoots);
      const to = resolveFreeName(file.title, trashNames);
      trashNames.add(to);
      trashedNameById.set(file.id, to);
      await operations.renameItem({ destination, from, to }, { refreshState: false });
      markCompleted(file.id);
    }
  }
  if (foreignRows.length > 0) {
    const foreignPaths = foreignRows.map((file) =>
      resolveDriveFileApiPath(file, username, groupRoots),
    );
    await operations.deleteItems(foreignPaths, { refreshState: false, signal: stop });
    for (const file of foreignRows) markCompleted(file.id);
  }
}

/** Moves files into `parent` one at a time and marks each rename the server applied. */
export async function moveDriveRows(
  { operations, username, groupRoots }: DriveRowsTarget,
  rows: readonly DriveFile[],
  parent: string,
  stop: AbortSignal,
  markCompleted: (id: string) => void,
): Promise<void> {
  const destination = apiPathFromUiPath(parent, username, groupRoots);
  for (const file of rows) {
    stop.throwIfAborted();
    const from = resolveDriveFileApiPath(file, username, groupRoots);
    await operations.renameItem({ destination, from, to: file.title }, { refreshState: false });
    markCompleted(file.id);
  }
}

/** Where each file went (`parent`, under `nameById` when set), to move it back on Undo. */
export function driveRestoreMoves(
  rows: readonly DriveFile[],
  parent: string,
  username: string,
  groupRoots: Set<string>,
  nameById?: ReadonlyMap<string, string>,
): DriveRestoreMove[] {
  return rows.map((file) => ({
    id: file.id,
    title: file.title,
    previousParent: file.parent,
    from: resolveDriveFileApiPath(
      { ...file, apiPath: undefined, parent, title: nameById?.get(file.id) ?? file.title },
      username,
      groupRoots,
    ),
  }));
}
