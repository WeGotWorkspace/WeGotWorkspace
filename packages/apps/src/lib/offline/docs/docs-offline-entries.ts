import type { DriveUIData } from "@/lib/files/drive-types";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { parentAndName } from "@/lib/files/api-path";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import { DOCS_DOMAIN, docsListingRowsTable } from "@/lib/offline/docs/docs-schema";
import {
  readDirectoryEntriesFromCache,
  readDriveEntryFromCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { nextPathAfterRename } from "@/lib/offline/shared/drive-sidecar-mutations";

/**
 * Drive-shaped entries the Docs home builds from this device while offline
 * (#1563): the Starred list (by path) and a folder listing such as Trash. The
 * Drive cache comes first, then a cached Docs listing row, then the queued
 * writes, so a Doc trashed offline is in Trash before the server knows.
 */

/** Offline the device cannot know the rights; the server checks them on sync. */
const OFFLINE_RIGHTS: WgwDriveDirectoryEntry["myRights"] = {
  mayView: true,
  mayComment: false,
  mayReview: false,
  mayEditContent: true,
  mayManageStructure: true,
  mayShare: false,
};

function apiPath(path: string): string {
  return `/${path.trim().replace(/^\/+|\/+$/g, "")}`;
}

function sourceKey(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

type FileFacts = { size: number; time: number };

function fileEntry(path: string, facts?: FileFacts): WgwDriveDirectoryEntry {
  const normalized = apiPath(path);
  return {
    type: "file",
    path: normalized,
    name: parentAndName(normalized).from,
    size: facts?.size ?? 0,
    time: facts?.time ?? 0,
    permissions: 0,
    myRights: OFFLINE_RIGHTS,
  };
}

/** Size and time of a Doc from any cached Docs listing view. */
async function readListedFacts(username: string): Promise<Map<string, FileFacts>> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const facts = new Map<string, FileFacts>();
  for (const row of await docsListingRowsTable(db).toArray()) {
    if (facts.has(row.sourceKey)) continue;
    try {
      const data = JSON.parse(row.data) as { size?: number; modifiedAt?: number };
      facts.set(row.sourceKey, { size: data.size ?? 0, time: data.modifiedAt ?? 0 });
    } catch {
      // A broken row only loses its size and time.
    }
  }
  return facts;
}

async function readQueuedPayloads(username: string): Promise<DocsOutboxPayload[]> {
  const payloads: DocsOutboxPayload[] = [];
  for (const row of await listOutboxMutationsForDomain(username, DOCS_DOMAIN)) {
    try {
      payloads.push(JSON.parse(row.payload) as DocsOutboxPayload);
    } catch {
      // The flush drops a row it cannot read.
    }
  }
  return payloads;
}

async function entryForPath(
  username: string,
  path: string,
  listed: Map<string, FileFacts>,
): Promise<WgwDriveDirectoryEntry> {
  const cached = await readDriveEntryFromCache(username, path);
  if (cached) return { ...cached, path: apiPath(path), name: parentAndName(apiPath(path)).from };
  return fileEntry(path, listed.get(sourceKey(path)));
}

/** Entries for these paths (the Starred list offline). Every path gets one. */
export async function readDocsOfflineEntriesByPaths(
  username: string,
  paths: readonly string[],
): Promise<WgwDriveDirectoryEntry[]> {
  const listed = await readListedFacts(username);
  const unique = [...new Set(paths.map(apiPath))];
  return Promise.all(unique.map((path) => entryForPath(username, path, listed)));
}

/**
 * The last live listing of each folder this tab saw (Trash, a Move target),
 * kept in memory like the Shared list (spec decision 4). The Drive cache can
 * lag: Drive's sync drops a Doc that moved into Trash from its cache.
 */
const liveDirectories = new Map<string, WgwDriveDirectoryEntry[]>();

function liveDirectoryKey(username: string, directory: string): string {
  return `${username}\u0000${sourceKey(directory)}`;
}

/** Remember a folder's live listing for this tab, for when it goes offline. */
export function rememberDocsLiveDirectory(
  username: string,
  directory: string,
  entries: readonly WgwDriveDirectoryEntry[],
): void {
  if (!username) return;
  liveDirectories.set(liveDirectoryKey(username, directory), [...entries]);
}

/** Tests only. */
export function forgetDocsLiveDirectories(): void {
  liveDirectories.clear();
}

/**
 * One folder as this device knows it: the Drive cache and this tab's last
 * live listing, minus what a queued trash or rename took away, plus what a
 * queued create, rename or trash put there.
 */
export async function readDocsOfflineDirectory(
  username: string,
  directory: string,
): Promise<DriveUIData> {
  const cwd = apiPath(directory);
  const listed = await readListedFacts(username);
  const leaving = new Set<string>();
  const arriving: Array<{ path: string; from?: string }> = [];
  for (const payload of await readQueuedPayloads(username)) {
    if (payload.op === "create") arriving.push({ path: apiPath(payload.apiPath) });
    if (payload.op === "rename" || payload.op === "trash") {
      leaving.add(apiPath(payload.from));
      arriving.push({
        path: apiPath(nextPathAfterRename(payload.from, payload.destination, payload.to)),
        from: payload.from,
      });
    }
  }
  const byPath = new Map<string, WgwDriveDirectoryEntry>();
  const known = [
    ...(await readDirectoryEntriesFromCache(username, cwd)),
    ...(liveDirectories.get(liveDirectoryKey(username, cwd)) ?? []),
  ];
  for (const entry of known) {
    const path = apiPath(entry.path);
    if (!leaving.has(path)) byPath.set(path, { ...entry, path });
  }
  for (const { path, from } of arriving) {
    if (parentAndName(path).destination !== cwd || leaving.has(path)) continue;
    const source = from ? await entryForPath(username, from, listed) : fileEntry(path);
    byPath.set(path, { ...source, path, name: parentAndName(path).from });
  }
  return {
    user: { username, name: username, role: "user", roots: [] },
    cwd,
    directory: { location: cwd, files: [...byPath.values()] },
  };
}
