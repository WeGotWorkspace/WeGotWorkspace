import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";
import { driveJmapSession, fileNodeToDirectoryEntry } from "@/lib/api/wgw/drive-jmap";
import { parentAndName } from "@/lib/files/api-path";
import type { JmapFileNode } from "@/lib/jmap-client";
import { JmapMethodError } from "@/lib/jmap-client";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  migrateDocsAvailabilityPath,
  stampDocsAvailabilityNodeIds,
} from "@/lib/offline/docs/docs-availability-store";
import { docsAvailabilityTable } from "@/lib/offline/docs/docs-schema";
import { migrateDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import { migrateDriveContentBlobPath } from "@/lib/offline/drive/drive-content-sync";
import {
  readDriveBootstrapFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { listKeptUnsavedDocumentPaths } from "@/lib/offline/drive/drive-fetched-set-prune";
import {
  deleteDriveEntryByPath,
  retainOrDropLocalDocument,
} from "@/lib/offline/drive/drive-local-document";
import { syncDriveMetadataTree } from "@/lib/offline/drive/drive-metadata-sync";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";

/** Meta key for the FileNode/changes `sinceState`. One token per account. */
export const DRIVE_FILE_NODE_SYNC_TOKEN_KEY = "drive:file-node-sync-state";

/** Safety cap on `hasMoreChanges` follow-ups inside one sync. Same bound as `JmapChatAdapter`. */
export const DRIVE_INBOUND_MAX_CHANGE_PAGES = 20;

const INITIAL_FILE_NODE_STATE = "0";

export type DriveInboundSyncResult = {
  changed: boolean;
  usedFullResync: boolean;
  /** Paths left in place because they still have unsaved collab work. */
  keptUnsavedPaths: string[];
};

const inFlight = new Map<string, Promise<DriveInboundSyncResult>>();

export async function readDriveSyncToken(username: string): Promise<string | null> {
  return readMeta(username, DRIVE_FILE_NODE_SYNC_TOKEN_KEY);
}

export async function writeDriveSyncToken(username: string, token: string): Promise<void> {
  await writeMeta(username, DRIVE_FILE_NODE_SYNC_TOKEN_KEY, token);
}

/**
 * FileNode/changes inbound. Created and updated rows are upserted by `nodeId`.
 * A path change migrates the cache row (and its sidecars) onto the new path.
 * `destroyed` drops the drive row, the pin, and the collab database unless
 * `PENDING_SERVER_SAVE_KEY` is set — then all three stay.
 *
 * `cannotCalculateChanges` (including a device past the 30-day tombstone
 * horizon) falls back to `syncDriveMetadataTree` and then primes the token
 * from `FileNode/get` with an empty id list. It does not call changes from `"0"`.
 */
export function syncDriveInboundFromFileNodes(
  username: string,
  options?: { signal?: AbortSignal },
): Promise<DriveInboundSyncResult> {
  if (!username) {
    return Promise.resolve({ changed: false, usedFullResync: false, keptUnsavedPaths: [] });
  }
  const existing = inFlight.get(username);
  if (existing) return existing;
  const run = runDriveInbound(username, options).finally(() => {
    if (inFlight.get(username) === run) inFlight.delete(username);
  });
  inFlight.set(username, run);
  return run;
}

async function runDriveInbound(
  username: string,
  options?: { signal?: AbortSignal },
): Promise<DriveInboundSyncResult> {
  if (!getConnectivitySnapshot()) {
    return { changed: false, usedFullResync: false, keptUnsavedPaths: [] };
  }
  const since = (await readDriveSyncToken(username)) ?? INITIAL_FILE_NODE_STATE;
  const session = await driveJmapSession();
  try {
    const drained = await drainFileNodeChanges(session, since, options?.signal);
    if (options?.signal?.aborted) {
      return { changed: false, usedFullResync: false, keptUnsavedPaths: [] };
    }
    const kept = await applyFileNodeChanges(username, session, drained, options?.signal);
    if (options?.signal?.aborted) {
      return {
        changed: kept.changed,
        usedFullResync: false,
        keptUnsavedPaths: kept.keptUnsavedPaths,
      };
    }
    // A blocked move stays unapplied. Leave the token so the next sync retries it.
    if (!kept.blocked) {
      await writeDriveSyncToken(username, drained.newState);
    }
    return {
      changed: kept.changed,
      usedFullResync: false,
      keptUnsavedPaths: kept.keptUnsavedPaths,
    };
  } catch (error) {
    if (!isCannotCalculateChanges(error)) throw error;
    return fullResync(username, session, options?.signal);
  }
}

/**
 * Follows `hasMoreChanges` the way `JmapChatAdapter` does. The token is the
 * last page actually read. Hitting the cap leaves the remainder for the next
 * sync instead of skipping it.
 */
async function drainFileNodeChanges(
  session: Awaited<ReturnType<typeof driveJmapSession>>,
  since: string,
  signal?: AbortSignal,
): Promise<{ created: string[]; updated: string[]; destroyed: string[]; newState: string }> {
  const created = new Set<string>();
  const updated = new Set<string>();
  const destroyed = new Set<string>();
  let sinceState = since;
  let newState = since;
  for (let page = 0; page < DRIVE_INBOUND_MAX_CHANGE_PAGES; page += 1) {
    const changes = await session.fileNodes.fileNodeChanges(session.accountId, sinceState, {
      signal,
    });
    for (const id of changes.created) created.add(id);
    for (const id of changes.updated) updated.add(id);
    for (const id of changes.destroyed) destroyed.add(id);
    newState = changes.newState;
    sinceState = changes.newState;
    if (!changes.hasMoreChanges) break;
    if (page === DRIVE_INBOUND_MAX_CHANGE_PAGES - 1) {
      console.warn("[drive-inbound] FileNode/changes still has more pages after the safety cap", {
        pages: DRIVE_INBOUND_MAX_CHANGE_PAGES,
      });
    }
  }
  return {
    created: [...created],
    updated: [...updated],
    destroyed: [...destroyed],
    newState,
  };
}

async function fullResync(
  username: string,
  session: Awaited<ReturnType<typeof driveJmapSession>>,
  signal?: AbortSignal,
): Promise<DriveInboundSyncResult> {
  const bootstrap = (await readDriveBootstrapFromCache(username)) ?? fallbackBootstrap(username);
  const progress = await syncDriveMetadataTree(username, bootstrap, { signal });
  if (signal?.aborted || progress.failed > 0) {
    return { changed: true, usedFullResync: true, keptUnsavedPaths: [] };
  }
  const state = await session.fileNodes.getFileNodes(session.accountId, [], { signal });
  await writeDriveSyncToken(username, state.state);
  return {
    changed: true,
    usedFullResync: true,
    keptUnsavedPaths: await listKeptUnsavedDocumentPaths(username),
  };
}

async function applyFileNodeChanges(
  username: string,
  session: Awaited<ReturnType<typeof driveJmapSession>>,
  changes: { created: string[]; updated: string[]; destroyed: string[] },
  signal?: AbortSignal,
): Promise<{ changed: boolean; keptUnsavedPaths: string[]; blocked: boolean }> {
  const destroyed = new Set(changes.destroyed);
  const upsertIds = [...new Set([...changes.created, ...changes.updated])].filter(
    (id) => !destroyed.has(id),
  );
  const upserted = new Set<string>();
  let changed = false;
  let blocked = false;
  const keptUnsavedPaths: string[] = [];
  if (upsertIds.length > 0) {
    const got = await session.fileNodes.getFileNodes(session.accountId, upsertIds, { signal });
    const ordered = parentsBeforeChildren(got.list);
    const cachePaths = await cachedPathsByNodeId(username);
    for (const node of ordered) {
      const path = await resolveNodePath(username, node, ordered, cachePaths, session, signal);
      if (!path) {
        console.warn("[drive-inbound] skipped FileNode with no resolvable path", { id: node.id });
        continue;
      }
      const placement = await moveCachedNodeToPath(username, node, path, cachePaths);
      if (placement === "blocked") {
        keptUnsavedPaths.push(normalizePath(path));
        blocked = true;
        continue;
      }
      await upsertDriveEntry(username, fileNodeToDirectoryEntry(path, node));
      await stampDocsAvailabilityNodeIds(username, [{ path, nodeId: node.id }]);
      cachePaths.set(node.id, path);
      upserted.add(node.id);
      changed = true;
    }
  }

  for (const id of changes.destroyed) {
    if (upserted.has(id)) continue;
    const paths = await pathsForNodeId(username, id);
    if (paths.length === 0) continue;
    for (const path of paths) {
      const outcome = await retainOrDropLocalDocument(username, path);
      if (outcome === "kept") {
        keptUnsavedPaths.push(normalizePath(path));
        continue;
      }
      await deleteDriveEntryByPath(username, path);
      changed = true;
    }
  }
  return { changed, keptUnsavedPaths: [...new Set(keptUnsavedPaths)], blocked };
}

async function moveCachedNodeToPath(
  username: string,
  node: JmapFileNode,
  nextPath: string,
  cachePaths: Map<string, string>,
): Promise<"moved" | "unchanged" | "blocked"> {
  const current = cachePaths.get(node.id);
  const nextId = normalizePath(nextPath);
  if (!current) return "unchanged";
  const oldId = normalizePath(current);
  if (oldId === nextId) return "unchanged";
  const occupant = await driveRowAt(username, nextId);
  if (occupant && occupant.nodeId && occupant.nodeId !== node.id) {
    const occupantOutcome = await retainOrDropLocalDocument(username, occupant.id);
    if (occupantOutcome === "kept") return "blocked";
    await deleteDriveEntryByPath(username, occupant.id);
  }
  const descendants = await descendantIds(username, oldId);
  const { destination, from } = parentAndName(`/${nextId}`);
  await applyDriveSidecarPathMigration(username, oldId, destination, from);
  for (const descendant of descendants) {
    const suffix = descendant.slice(oldId.length);
    await migrateDescendantSidecars(username, descendant, `${nextId}${suffix}`);
  }
  cachePaths.set(node.id, `/${nextId}`);
  return "moved";
}

/**
 * Pins and blobs of a descendant follow the new path. The collab database does
 * not move: Docs keys it on the FileNode id, which a rename keeps.
 */
async function migrateDescendantSidecars(
  username: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (normalizePath(oldPath) === normalizePath(newPath)) return;
  await migrateDocsAvailabilityPath(username, oldPath, newPath);
  await migrateDriveAvailabilityPath(username, oldPath, newPath);
  await migrateDriveContentBlobPath(username, oldPath, newPath);
}

async function resolveNodePath(
  username: string,
  node: JmapFileNode,
  batch: readonly JmapFileNode[],
  cachePaths: Map<string, string>,
  session: Awaited<ReturnType<typeof driveJmapSession>>,
  signal?: AbortSignal,
): Promise<string | null> {
  const byId = new Map(batch.map((item) => [item.id, item]));
  const resolved = new Map<string, string>();
  const changing = new Set(batch.map((item) => item.id));

  async function resolve(id: string, stack: string[]): Promise<string | null> {
    if (stack.includes(id)) return null;
    const fresh = resolved.get(id);
    if (fresh) return fresh;
    if (!changing.has(id)) {
      const cached = cachePaths.get(id);
      if (cached) return cached;
    }
    let current = byId.get(id);
    if (!current) {
      const got = await session.fileNodes.getFileNodes(session.accountId, [id], { signal });
      current = got.list.find((item) => item.id === id);
      if (!current) return null;
      byId.set(current.id, current);
    }
    let path: string;
    if (!current.parentId) {
      // Account roots only: home is `/users/{username}`, every other parentless
      // node is `/groups/{name}` (same rule as `rememberTopLevel`). A share
      // rooted under someone else's tree has a parent FileNode/get will not
      // return, so this walk yields null and the caller skips the node.
      path = current.name === username ? `/users/${username}` : `/groups/${current.name}`;
    } else {
      const parent = await resolve(current.parentId, [...stack, id]);
      if (!parent) return null;
      path = `${parent.replace(/\/$/, "")}/${current.name}`;
    }
    resolved.set(id, path);
    return path;
  }

  return resolve(node.id, []);
}

function parentsBeforeChildren(nodes: readonly JmapFileNode[]): JmapFileNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered: JmapFileNode[] = [];
  const seen = new Set<string>();
  const visit = (node: JmapFileNode): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent) visit(parent);
    }
    ordered.push(node);
  };
  for (const node of nodes) visit(node);
  return ordered;
}

async function cachedPathsByNodeId(username: string): Promise<Map<string, string>> {
  const rows = await driveEntriesTable(accountDb(username)).where("nodeId").above("").toArray();
  const paths = new Map<string, string>();
  for (const row of rows) {
    const nodeId = row.nodeId?.trim();
    if (!nodeId) continue;
    paths.set(nodeId, row.id.startsWith("/") ? row.id : `/${row.id}`);
  }
  return paths;
}

async function pathsForNodeId(username: string, nodeId: string): Promise<string[]> {
  const db = accountDb(username);
  const driveRows = await driveEntriesTable(db).where("nodeId").equals(nodeId).toArray();
  const pins = await docsAvailabilityTable(db).where("nodeId").equals(nodeId).toArray();
  const paths = new Set<string>();
  for (const row of driveRows) paths.add(row.id);
  for (const pin of pins) paths.add(pin.id);
  return [...paths];
}

async function driveRowAt(
  username: string,
  apiPath: string,
): Promise<OfflineDriveEntryRow | undefined> {
  return driveEntriesTable(accountDb(username)).get(normalizePath(apiPath));
}

async function descendantIds(username: string, oldId: string): Promise<string[]> {
  const table = driveEntriesTable(accountDb(username));
  const ids: string[] = [];
  const pending = [oldId];
  const seen = new Set<string>([oldId]);
  while (pending.length > 0) {
    const parent = pending.shift();
    if (!parent) continue;
    const children = await table.where("parentPath").equals(parent).toArray();
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      ids.push(child.id);
      if (child.type === "dir") pending.push(child.id);
    }
  }
  return ids;
}

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

function isCannotCalculateChanges(error: unknown): boolean {
  return error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges";
}

function fallbackBootstrap(username: string): DriveAppBootstrap {
  return {
    session: { user: { displayName: username, username } },
    data: {
      user: { username, name: username, role: "user", roots: ["/users"] },
      cwd: `/users/${username}`,
      directory: { location: `/users/${username}`, files: [] },
    },
  };
}
