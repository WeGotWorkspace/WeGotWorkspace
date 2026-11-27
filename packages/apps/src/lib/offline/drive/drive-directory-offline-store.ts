import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { rememberOfflineUsername } from "@/lib/offline/core/offline-account";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  driveEntriesTable,
  DRIVE_DOMAIN,
  type OfflineDriveEntryRow,
} from "@/lib/offline/drive/drive-schema";
import { driveUploadItemsTable } from "@/lib/offline/drive/upload/drive-upload-schema";
import type { DriveAppBootstrap, DriveUIData } from "@/lib/files/drive-types";
import { parentAndName } from "@/lib/files/api-path";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import {
  areaFromCrawledPath,
  fileExtension,
  isDotName,
  isTrashTreePath,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";

const DRIVE_BOOTSTRAP_META_KEY = "drive:bootstrap";

export function normalizeDriveEntryPath(path: string): string {
  return normalizeOfflinePath(path);
}

function parseEntryRow(row: OfflineDriveEntryRow): WgwDriveDirectoryEntry {
  return JSON.parse(row.data) as WgwDriveDirectoryEntry;
}

export async function writeDriveBootstrapToCache(
  username: string,
  bootstrap: DriveAppBootstrap,
): Promise<void> {
  await writeMeta(username, DRIVE_BOOTSTRAP_META_KEY, JSON.stringify(bootstrap));
  rememberOfflineUsername(DRIVE_DOMAIN, username);
}

export async function readDriveBootstrapFromCache(
  username: string,
): Promise<DriveAppBootstrap | null> {
  const raw = await readMeta(username, DRIVE_BOOTSTRAP_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DriveAppBootstrap;
  } catch {
    return null;
  }
}

/** The `drive_entries` row for a listing entry. */
export function driveEntryRowFromEntry(
  entry: WgwDriveDirectoryEntry,
  area?: DriveEntryArea,
): OfflineDriveEntryRow {
  const id = normalizeDriveEntryPath(entry.path);
  const parentPath = normalizeDriveEntryPath(parentAndName(`/${id}`).destination);
  const nodeId = entry.nodeId?.trim();
  const type = entry.type === "dir" ? "dir" : "file";
  return {
    id,
    parentPath: parentPath || "",
    type,
    modifiedAt: entry.time ?? 0,
    data: JSON.stringify(entry),
    ...(nodeId ? { nodeId } : {}),
    ...(type === "file" ? { ext: fileExtension(entry.name || (id.split("/").pop() ?? "")) } : {}),
    ...(area ? { area } : {}),
  };
}

/**
 * A folder or file this device just created on the server (#2063 C3): filed
 * under its parent with the parent's `area` (or, under an account root, the
 * root's) and the parent's rights, so the tree views show it before the push.
 * The next change for its node fills in the rest.
 */
export async function addCreatedDriveEntry(
  username: string,
  parentApiPath: string,
  name: string,
  type: "dir" | "file",
): Promise<void> {
  const table = driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
  const parentId = normalizeDriveEntryPath(parentApiPath);
  const id = parentId ? `${parentId}/${name}` : name;
  // The server answers a name that already exists as a success: the row there
  // (its node id, size, rights) stays as it is.
  if (await table.get(id)) return;
  const parent = parentId ? await table.get(parentId) : undefined;
  const parentEntry = parent ? parseEntryRow(parent) : null;
  const entry: WgwDriveDirectoryEntry = {
    type,
    path: `/${id}`,
    name,
    size: 0,
    time: Math.floor(Date.now() / 1000),
    permissions: 0,
    // Under a root there is no parent row: the person just created it there.
    myRights: parentEntry?.myRights ?? {
      mayView: true,
      mayComment: true,
      mayReview: true,
      mayEditContent: true,
      mayManageStructure: true,
      mayShare: true,
    },
  };
  await table.put(driveEntryRowFromEntry(entry, parent?.area ?? areaFromCrawledPath(id)));
}

/**
 * Upsert one listing entry. Without `area`, the row keeps the area it had at
 * this path, or takes its parent folder's: writers other than the tree sync
 * (operations, uploads, folder listings) do not know it. A row whose parent
 * has no row sits at an account root (share roots come from the tree sync with
 * their area), so its area follows from the path.
 */
export async function upsertDriveEntry(
  username: string,
  entry: WgwDriveDirectoryEntry,
  area?: DriveEntryArea,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = driveEntriesTable(db);
  const row = driveEntryRowFromEntry(entry, area);
  if (!row.area) {
    const parent = await table.get(row.parentPath);
    const known = (await table.get(row.id))?.area ?? parent?.area;
    if (known) row.area = known;
    else if (!parent) row.area = areaFromCrawledPath(row.id);
  }
  if (row.type !== "dir") {
    await table.put(row);
    return;
  }
  // Same tables the batch end locks, so a refresh sees the live item or the committed clear.
  await db.transaction("rw", table, driveUploadItemsTable(db), async () => {
    const existing = await table.get(row.id);
    // A folder still taking an upload keeps its marker until the upload is done (#1620).
    if (
      existing?.uploadId &&
      existing.type === "dir" &&
      (await driveUploadItemsTable(db).get(existing.uploadId))
    ) {
      const { upload } = parseEntryRow(existing);
      await table.put({
        ...row,
        uploadId: existing.uploadId,
        data: JSON.stringify({ ...entry, upload }),
      });
      return;
    }
    await table.put(row);
  });
}

/**
 * Upsert many entries in one transaction, with the same rules as
 * {@link upsertDriveEntry}: a row without `area` keeps the one it had, and a
 * folder still taking an upload keeps its marker. With `skipOtherNodes`, a path
 * whose row belongs to another FileNode is left alone (the tree walk writes it
 * at the end of the pass, after that node's blob and pins have moved).
 */
export async function upsertDriveEntriesInBulk(
  username: string,
  items: readonly { entry: WgwDriveDirectoryEntry; area?: DriveEntryArea }[],
  options?: { skipOtherNodes?: boolean },
): Promise<void> {
  if (items.length === 0) return;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = driveEntriesTable(db);
  const uploads = driveUploadItemsTable(db);
  await db.transaction("rw", table, uploads, async () => {
    const rows = items.map(({ entry, area }) => driveEntryRowFromEntry(entry, area));
    const existing = await table.bulkGet(rows.map((row) => row.id));
    const writes: OfflineDriveEntryRow[] = [];
    for (const [index, row] of rows.entries()) {
      const previous = existing[index];
      if (options?.skipOtherNodes && previous?.nodeId && previous.nodeId !== row.nodeId) continue;
      if (!row.area && previous?.area) row.area = previous.area;
      if (
        row.type === "dir" &&
        previous?.type === "dir" &&
        previous.uploadId &&
        (await uploads.get(previous.uploadId))
      ) {
        const { upload } = parseEntryRow(previous);
        row.uploadId = previous.uploadId;
        row.data = JSON.stringify({ ...items[index]!.entry, upload });
      }
      writes.push(row);
    }
    await table.bulkPut(writes);
  });
}

/** Path → FileNode id from the offline cache. `undefined` until a crawl has stored it. */
export async function readCachedDriveNodeId(
  username: string,
  apiPath: string,
): Promise<string | undefined> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await driveEntriesTable(db).get(normalizeDriveEntryPath(apiPath));
  const nodeId = row?.nodeId?.trim();
  return nodeId || undefined;
}

/**
 * FileNode id → path (leading slash) from the offline cache. `undefined` when no
 * file row has the id, or when two file rows claim it (a stale row the next crawl
 * fixes): an ambiguous answer must not open the wrong document.
 */
export async function readCachedDrivePathForNodeId(
  username: string,
  nodeId: string,
): Promise<string | undefined> {
  const id = nodeId.trim();
  if (!id) return undefined;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await driveEntriesTable(db).where("nodeId").equals(id).toArray();
  const files = rows.filter((row) => row.type === "file");
  if (files.length !== 1) return undefined;
  return `/${files[0].id.replace(/^\/+/, "")}`;
}

export async function upsertDriveEntries(
  username: string,
  entries: readonly WgwDriveDirectoryEntry[],
): Promise<void> {
  for (const entry of entries) {
    await upsertDriveEntry(username, entry);
  }
}

export async function readDirectoryEntriesFromCache(
  username: string,
  parentPath: string,
): Promise<WgwDriveDirectoryEntry[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const normalizedParent = normalizeDriveEntryPath(parentPath);
  const rows = await driveEntriesTable(db).where("parentPath").equals(normalizedParent).toArray();
  // The tree also holds `.Trash`; a folder view never lists a dot name.
  return rows.map(parseEntryRow).filter((entry) => !isDotName(entry.name));
}

export async function readDriveEntryFromCache(
  username: string,
  apiPath: string,
): Promise<WgwDriveDirectoryEntry | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await driveEntriesTable(db).get(normalizeDriveEntryPath(apiPath));
  return row ? parseEntryRow(row) : null;
}

export async function removeDriveEntry(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).delete(normalizeDriveEntryPath(apiPath));
}

export async function removeDriveEntriesUnderPrefix(
  username: string,
  prefix: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const normalizedPrefix = normalizeDriveEntryPath(prefix);
  const rows = await driveEntriesTable(db).toArray();
  const toDelete = rows.filter(
    (row) => row.id === normalizedPrefix || row.id.startsWith(`${normalizedPrefix}/`),
  );
  await driveEntriesTable(db).bulkDelete(toDelete.map((row) => row.id));
}

/** A rename can change a file's `ext` view index (#2063 C3); `areaAfterMove` decides `area`. */
function movedRowExt(row: { type: string }, newId: string): { ext?: string } {
  return row.type === "file" ? { ext: fileExtension(newId.split("/").pop() ?? "") } : {};
}

export async function migrateDriveEntryPath(
  username: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = driveEntriesTable(db);
  const oldId = normalizeDriveEntryPath(oldPath);
  const newId = normalizeDriveEntryPath(newPath);
  const row = await table.get(oldId);
  if (!row) return;
  const entry = parseEntryRow(row);
  entry.path = newId.startsWith("/") ? newId : `/${newId}`;
  entry.name = newId.split("/").pop() ?? entry.name;
  const newParent = normalizeDriveEntryPath(parentAndName(`/${newId}`).destination);
  const area = await areaAfterMove(table, username, row, newId, newParent);
  await table.put({
    ...row,
    ...movedRowExt(row, newId),
    id: newId,
    parentPath: newParent,
    area,
    data: JSON.stringify(entry),
  });
  await table.delete(oldId);

  const descendants = await table
    .filter((candidate) => candidate.id.startsWith(`${oldId}/`))
    .toArray();
  for (const descendant of descendants) {
    const suffix = descendant.id.slice(oldId.length);
    const migratedId = `${newId}${suffix}`;
    const migratedEntry = parseEntryRow(descendant);
    migratedEntry.path = migratedId.startsWith("/") ? migratedId : `/${migratedId}`;
    const migratedParent = normalizeDriveEntryPath(parentAndName(`/${migratedId}`).destination);
    // Spread the row so `nodeId` and an upload placeholder's `uploadId` move along.
    await table.put({
      ...descendant,
      ...movedRowExt(descendant, migratedId),
      id: migratedId,
      parentPath: migratedParent,
      area: isTrashTreePath(migratedId) ? "trash" : (area ?? descendant.area),
      data: JSON.stringify(migratedEntry),
    });
    await table.delete(descendant.id);
  }
}

/**
 * `area` of a row a local move puts at `newId`: Trash by path; else its new
 * parent row's; else, under an account root (home or a team drive), the
 * root's; else the row keeps its own (a renamed share root stays `share`),
 * unless it comes out of Trash.
 */
async function areaAfterMove(
  table: ReturnType<typeof driveEntriesTable>,
  username: string,
  row: OfflineDriveEntryRow,
  newId: string,
  newParent: string,
): Promise<DriveEntryArea | undefined> {
  if (isTrashTreePath(newId)) return "trash";
  const parentArea = newParent ? (await table.get(newParent))?.area : undefined;
  if (parentArea) return parentArea;
  const parts = newParent.split("/");
  const underAccountRoot =
    parts.length === 2 &&
    ((parts[0] === "users" && parts[1]?.toLowerCase() === username.trim().toLowerCase()) ||
      parts[0] === "groups");
  if (underAccountRoot || row.area === "trash") return areaFromCrawledPath(newId);
  return row.area;
}

export async function searchDriveEntriesFromCache(
  username: string,
  query: string,
  limit = 100,
): Promise<WgwDriveDirectoryEntry[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const rows = await driveEntriesTable(db).toArray();
  const matches: WgwDriveDirectoryEntry[] = [];
  for (const row of rows) {
    if (row.uploadId || isHiddenDrivePath(row.id)) continue;
    const entry = parseEntryRow(row);
    if (entry.name.toLowerCase().includes(needle)) {
      matches.push(entry);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

export function buildOfflineDriveUIData(
  bootstrap: DriveAppBootstrap,
  cwd: string,
  entries: readonly WgwDriveDirectoryEntry[],
): DriveUIData {
  const userRoot = normalizeApiVirtualPath(`/users/${bootstrap.data.user.username}`);
  const normalizedCwd = normalizeApiVirtualPath(cwd);
  const files = [...entries];
  if (normalizedCwd === userRoot) {
    const groupRows = entries.filter((entry) => entry.path.startsWith("/groups/"));
    const existing = new Set(files.map((entry) => normalizeDriveEntryPath(entry.path)));
    for (const row of groupRows) {
      if (!existing.has(normalizeDriveEntryPath(row.path))) {
        files.push(row);
      }
    }
  }
  return {
    user: bootstrap.data.user,
    cwd: normalizedCwd,
    directory: { location: normalizedCwd, files },
  };
}

export async function listAllCachedDriveEntryPaths(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await driveEntriesTable(db).toArray();
  // Upload placeholders have no server content to sync yet; Trash bodies are not synced.
  return rows
    .filter((row) => row.type === "file" && !row.uploadId && !isHiddenDrivePath(row.id))
    .map((row) => row.id);
}

/** A dot segment (`.Trash`, app data) keeps a path out of All Files, as on the server. */
function isHiddenDrivePath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * All Files from the offline cache: one page of every cached file across the
 * viewer's drives (the metadata crawl covers the home and every group drive),
 * newest first, the same shape `listAllFiles` returns online.
 */
export async function listAllCachedDriveFiles(
  username: string,
  input: { offset: number; limit: number },
): Promise<{ entries: WgwDriveDirectoryEntry[]; nextOffset: number; hasMore: boolean }> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await driveEntriesTable(db).toArray();
  const files = rows
    .filter((row) => row.type === "file" && !row.uploadId)
    .map(parseEntryRow)
    .filter((entry) => !isHiddenDrivePath(entry.path))
    .sort((a, b) => b.time - a.time || a.path.localeCompare(b.path));
  const end = input.offset + input.limit;
  return {
    entries: files.slice(input.offset, end),
    nextOffset: Math.min(end, files.length),
    hasMore: end < files.length,
  };
}
