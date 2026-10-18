import { rememberOfflineDocsUsername } from "@/lib/offline/offline-session";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import {
  docsAvailabilityTable,
  type OfflineDocsAvailabilityRow,
} from "@/lib/offline/docs/docs-schema";

export function normalizeDocsAvailabilityPath(apiPath: string): string {
  return normalizeOfflinePath(apiPath);
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

/**
 * Write a pin. `nodeId` is the document identity; a rewrite without one keeps
 * the id already stored, so re-pinning never forgets which document it is.
 */
export async function writeDocsAvailability(
  username: string,
  row: Pick<OfflineDocsAvailabilityRow, "id" | "location"> &
    Partial<Pick<OfflineDocsAvailabilityRow, "pinnedAt" | "lastSyncedAt" | "nodeId">>,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = docsAvailabilityTable(db);
  const id = normalizeDocsAvailabilityPath(row.id);
  const nodeId = row.nodeId?.trim() || (await table.get(id))?.nodeId;
  await table.put({
    id,
    location: row.location,
    pinnedAt: row.pinnedAt ?? Date.now(),
    lastSyncedAt: row.lastSyncedAt ?? null,
    ...(nodeId ? { nodeId } : {}),
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
  const pins = new Map((await table.toArray()).map((row) => [row.id, row]));
  for (const entry of entries) {
    const nodeId = entry.nodeId?.trim();
    if (!nodeId) continue;
    const id = normalizeDocsAvailabilityPath(entry.path);
    const existing = pins.get(id);
    if (!existing || existing.nodeId === nodeId) continue;
    const next = { ...existing, nodeId };
    pins.set(id, next);
    await table.put(next);
  }
}

/**
 * Move every pin of a FileNode to `newPath`, matched on `nodeId` rather than
 * on the path the pin was stored under. A pin whose path went stale still
 * follows its document.
 */
export async function moveDocsAvailabilityForNode(
  username: string,
  nodeId: string,
  newPath: string,
): Promise<void> {
  const id = nodeId.trim();
  if (!id) return;
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = docsAvailabilityTable(db);
  const newId = normalizeDocsAvailabilityPath(newPath);
  const pins = await table.where("nodeId").equals(id).toArray();
  const stale = pins.filter((pin) => pin.id !== newId);
  if (stale.length === 0) return;
  const kept = pins.find((pin) => pin.id === newId) ?? stale[0]!;
  await table.put({ ...kept, id: newId, nodeId: id });
  for (const pin of stale) await table.delete(pin.id);
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
