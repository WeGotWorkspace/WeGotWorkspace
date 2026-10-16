import { rememberOfflineDocsUsername } from "@/lib/offline/offline-session";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  docsAvailabilityTable,
  type OfflineDocsAvailabilityRow,
} from "@/lib/offline/docs/docs-schema";

export function normalizeDocsAvailabilityPath(apiPath: string): string {
  return apiPath.trim().replace(/^\/+/, "");
}

export async function listDocsAvailability(
  username: string,
): Promise<OfflineDocsAvailabilityRow[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return docsAvailabilityTable(db).orderBy("pinnedAt").reverse().toArray();
}

export async function readDocsAvailability(
  username: string,
  apiPath: string,
): Promise<OfflineDocsAvailabilityRow | undefined> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return docsAvailabilityTable(db).get(normalizeDocsAvailabilityPath(apiPath));
}

export async function writeDocsAvailability(
  username: string,
  row: Pick<OfflineDocsAvailabilityRow, "id" | "location"> &
    Partial<Pick<OfflineDocsAvailabilityRow, "pinnedAt" | "lastSyncedAt">>,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const id = normalizeDocsAvailabilityPath(row.id);
  await docsAvailabilityTable(db).put({
    id,
    location: row.location,
    pinnedAt: row.pinnedAt ?? Date.now(),
    lastSyncedAt: row.lastSyncedAt ?? null,
  });
  rememberOfflineDocsUsername(username);
}

export async function removeDocsAvailability(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await docsAvailabilityTable(db).delete(normalizeDocsAvailabilityPath(apiPath));
}

export async function markDocsAvailabilitySynced(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const id = normalizeDocsAvailabilityPath(apiPath);
  const existing = await docsAvailabilityTable(db).get(id);
  if (!existing) return;
  await docsAvailabilityTable(db).put({
    ...existing,
    lastSyncedAt: Date.now(),
  });
}

/** Fill `nodeId` on pins whose path the crawl just saw. Missing ids stay missing. */
export async function stampDocsAvailabilityNodeIds(
  username: string,
  entries: readonly { path: string; nodeId?: string }[],
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = docsAvailabilityTable(db);
  for (const entry of entries) {
    const nodeId = entry.nodeId?.trim();
    if (!nodeId) continue;
    const id = normalizeDocsAvailabilityPath(entry.path);
    const existing = await table.get(id);
    if (!existing || existing.nodeId === nodeId) continue;
    await table.put({ ...existing, nodeId });
  }
}

export async function migrateDocsAvailabilityPath(
  username: string,
  oldPath: string,
  newPath: string,
  location?: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = docsAvailabilityTable(db);
  const oldId = normalizeDocsAvailabilityPath(oldPath);
  const newId = normalizeDocsAvailabilityPath(newPath);
  if (oldId === newId) return;

  const existing = await table.get(oldId);
  if (!existing) return;

  await table.put({
    ...existing,
    id: newId,
    location: location ?? existing.location,
  });
  await table.delete(oldId);
}
