import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import { rememberOfflineUsername } from "@/lib/offline/core/offline-account";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  driveEntriesTable,
  DRIVE_DOMAIN,
  type OfflineDriveEntryRow,
} from "@/lib/offline/drive/drive-schema";
import type { DriveAppBootstrap, DriveUIData } from "@/drive-core/src/drive-types";
import { parentAndName } from "@/lib/files/api-path";

const DRIVE_BOOTSTRAP_META_KEY = "drive:bootstrap";

export function normalizeDriveEntryPath(path: string): string {
  return path.trim().replace(/^\/+/, "");
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

export async function upsertDriveEntry(
  username: string,
  entry: WgwDriveDirectoryEntry,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const id = normalizeDriveEntryPath(entry.path);
  const parentPath = normalizeDriveEntryPath(parentAndName(`/${id}`).destination);
  await driveEntriesTable(db).put({
    id,
    parentPath: parentPath || "",
    type: entry.type === "dir" ? "dir" : "file",
    modifiedAt: entry.time ?? 0,
    data: JSON.stringify(entry),
  });
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
  return rows.map(parseEntryRow);
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
  await table.put({
    id: newId,
    parentPath: newParent,
    type: row.type,
    modifiedAt: row.modifiedAt,
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
    await table.put({
      id: migratedId,
      parentPath: migratedParent,
      type: descendant.type,
      modifiedAt: descendant.modifiedAt,
      data: JSON.stringify(migratedEntry),
    });
    await table.delete(descendant.id);
  }
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
  return rows.filter((row) => row.type === "file").map((row) => row.id);
}
