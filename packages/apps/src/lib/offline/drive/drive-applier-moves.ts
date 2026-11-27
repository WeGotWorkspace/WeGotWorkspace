import { parentAndName } from "@/lib/files/api-path";
import type { DocsInboundChange } from "@/lib/offline/docs/docs-inbound-sync";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import { deleteDriveEntryByPath } from "@/lib/offline/drive/drive-local-document";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import type { SidecarMoves } from "@/lib/offline/drive/drive-sidecar-moves";
import {
  isHiddenTreePath,
  isTrashTreePath,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";

/**
 * One node of a `FileNode/changes` batch that left its cached path, as row ids
 * (no leading `/`). `to` may be a dot path: the node left the list rows.
 * `area` is filled in once the node itself is written.
 */
export type PathMove = { from: string; to: string; area?: DriveEntryArea };

/** A cached row the batch did not list, and the path it moves to. */
export type PrefixMove = { row: OfflineDriveEntryRow; id: string; move: PathMove };

/**
 * Every cached row under one of `oldPaths`, read before the batch writes
 * anything: the prefix moves match on these original paths.
 */
export async function rowsUnderOldPaths(
  username: string,
  oldPaths: Iterable<string>,
): Promise<OfflineDriveEntryRow[]> {
  const table = driveEntriesTable(accountDb(username));
  const rows = new Map<string, OfflineDriveEntryRow>();
  for (const from of new Set(oldPaths)) {
    for (const row of await table.where("id").startsWith(`${from}/`).toArray()) {
      rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

/**
 * The batch's other cached rows (descendants it did not list, upload
 * placeholders): each gets the single longest moved prefix applied once, on
 * its original path (`from + '/'` boundary). A row whose new path is a dot
 * path leaves the tree instead (`hidden`).
 */
export function planPrefixMoves(
  under: readonly OfflineDriveEntryRow[],
  moves: readonly PathMove[],
  batchIds: ReadonlySet<string>,
): { moved: PrefixMove[]; hidden: string[] } {
  const longestFirst = [...moves].sort((a, b) => b.from.length - a.from.length);
  const moved: PrefixMove[] = [];
  const hidden: string[] = [];
  for (const row of under) {
    if (row.nodeId && batchIds.has(row.nodeId)) continue;
    const move = longestFirst.find(({ from }) => row.id.startsWith(`${from}/`));
    if (!move) continue;
    const id = `${move.to}${row.id.slice(move.from.length)}`;
    if (isHiddenTreePath(id)) hidden.push(row.id);
    else moved.push({ row, id, move });
  }
  return { moved, hidden };
}

/**
 * Write the planned prefix moves: the new row with the moved node's `area`
 * (Trash by path), its blob and pins queued on `sidecars`, a Docs `moved` per
 * file. An original path is deleted only when nothing in this batch lands on
 * it. Run inside the batch's transaction.
 */
export async function writePrefixMoves(
  username: string,
  planned: readonly PrefixMove[],
  destinations: ReadonlySet<string>,
  sidecars: SidecarMoves,
  docsChanges: DocsInboundChange[],
): Promise<void> {
  const table = driveEntriesTable(accountDb(username));
  for (const { row } of planned) {
    if (!destinations.has(row.id)) await table.delete(row.id);
  }
  for (const { row, id, move } of planned) {
    const entry = parseEntry(row.data);
    if (row.type !== "dir") {
      docsChanges.push({
        kind: "moved",
        from: `/${row.id}`,
        to: `/${id}`,
        node: {
          directory: false,
          size: typeof entry.size === "number" ? entry.size : 0,
          modifiedAt: typeof entry.time === "number" ? entry.time : 0,
        },
      });
    }
    await table.put({
      ...row,
      id,
      parentPath: parentAndName(`/${id}`).destination.replace(/^\/+/, ""),
      area: isTrashTreePath(id) ? "trash" : (move.area ?? row.area),
      data: JSON.stringify({ ...entry, path: `/${id}` }),
    });
    sidecars.add(row.id, id);
  }
}

/**
 * Delete a row that left the tree (its Doc already checked for unsaved work).
 * When another node of the batch lands on the same path, only the leaving
 * row's blob and pin go; the new row stays. Run inside the batch's transaction,
 * before the sidecar moves.
 */
export async function deleteLeavingRow(
  username: string,
  path: string,
  destinations: ReadonlySet<string>,
): Promise<void> {
  if (destinations.has(path)) {
    await removeDriveContentBlob(username, path);
    await removeDriveAvailability(username, path);
  } else {
    await deleteDriveEntryByPath(username, path);
  }
}

function parseEntry(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}
