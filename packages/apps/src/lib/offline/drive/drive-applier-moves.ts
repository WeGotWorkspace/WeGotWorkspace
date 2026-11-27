import { parentAndName } from "@/lib/files/api-path";
import type { DocsInboundChange } from "@/lib/offline/docs/docs-inbound-sync";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import {
  deleteDriveEntryByPath,
  retainOrDropLocalDocument,
} from "@/lib/offline/drive/drive-local-document";
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
 */
export type PathMove = { from: string; to: string; area: DriveEntryArea | undefined };

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
 * its original path (`from + '/'` boundary), and the moved node's `area`
 * (Trash by path). Its blob and pins are queued on `sidecars`. A row whose new
 * path is a dot path is dropped instead (a Doc with unsaved work stays). An
 * original path is deleted only when nothing in this batch lands on it.
 */
export async function moveRowsUnderMovedPaths(
  username: string,
  under: readonly OfflineDriveEntryRow[],
  moves: readonly PathMove[],
  batchIds: ReadonlySet<string>,
  destinations: Set<string>,
  sidecars: SidecarMoves,
  docsChanges: DocsInboundChange[],
): Promise<{ kept: string[]; changed: boolean }> {
  const longestFirst = [...moves].sort((a, b) => b.from.length - a.from.length);
  const planned: Array<{
    row: OfflineDriveEntryRow;
    id: string;
    area: DriveEntryArea | undefined;
  }> = [];
  const hidden: string[] = [];
  for (const row of under) {
    if (row.nodeId && batchIds.has(row.nodeId)) continue;
    const move = longestFirst.find(({ from }) => row.id.startsWith(`${from}/`));
    if (!move) continue;
    const id = `${move.to}${row.id.slice(move.from.length)}`;
    if (isHiddenTreePath(id)) hidden.push(row.id);
    else planned.push({ row, id, area: isTrashTreePath(id) ? "trash" : (move.area ?? row.area) });
  }
  for (const { id } of planned) destinations.add(id);

  const kept: string[] = [];
  for (const path of hidden) {
    if ((await dropRowLeavingTree(username, path, destinations)) === "kept") kept.push(path);
    else docsChanges.push({ kind: "removed", path });
  }
  const table = driveEntriesTable(accountDb(username));
  for (const { row } of planned) {
    if (!destinations.has(row.id)) await table.delete(row.id);
  }
  for (const { row, id, area } of planned) {
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
      area,
      data: JSON.stringify({ ...entry, path: `/${id}` }),
    });
    sidecars.add(row.id, id);
  }
  return { kept, changed: hidden.length + planned.length > kept.length };
}

/**
 * A row that leaves the list rows (moved under a dot folder). A Doc with
 * unsaved work stays. When another node of the batch lands on the same path,
 * only the leaving row's blob and pin go; the new row stays.
 */
export async function dropRowLeavingTree(
  username: string,
  path: string,
  destinations: ReadonlySet<string>,
): Promise<"kept" | "dropped"> {
  if ((await retainOrDropLocalDocument(username, path)) === "kept") return "kept";
  if (destinations.has(path)) {
    await removeDriveContentBlob(username, path);
    await removeDriveAvailability(username, path);
  } else {
    await deleteDriveEntryByPath(username, path);
  }
  return "dropped";
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
