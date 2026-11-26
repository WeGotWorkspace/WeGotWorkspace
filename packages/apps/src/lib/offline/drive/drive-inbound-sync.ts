import {
  driveJmapSession,
  fileNodeToDirectoryEntry,
  fileNodeVirtualPath,
} from "@/lib/api/wgw/drive-jmap";
import { parentAndName } from "@/lib/files/api-path";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { JmapFileNode } from "@/lib/jmap-client";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  moveDocsAvailabilityForNode,
  stampDocsAvailabilityNodeIds,
} from "@/lib/offline/docs/docs-availability-store";
import { docsAvailabilityTable } from "@/lib/offline/docs/docs-schema";
import {
  applyDocsInboundChanges,
  type DocsInboundChange,
} from "@/lib/offline/docs/docs-inbound-sync";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import {
  drainFileNodeChanges,
  isCannotCalculateChanges,
  readDriveSyncToken,
  writeDriveSyncToken,
} from "@/lib/offline/drive/drive-file-node-changes";
import { listKeptUnsavedDocumentPaths } from "@/lib/offline/drive/drive-fetched-set-prune";
import {
  deleteDriveEntryByPath,
  retainOrDropLocalDocument,
} from "@/lib/offline/drive/drive-local-document";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import {
  areaForRoot,
  isHiddenTreePath,
  isTrashTreePath,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";
import {
  migrateNodeSidecars,
  readDriveTreeFirstSyncDone,
  readDriveTreeRoots,
  syncDriveTree,
} from "@/lib/offline/drive/drive-tree-sync";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";

export {
  DRIVE_FILE_NODE_SYNC_TOKEN_KEY,
  DRIVE_INBOUND_MAX_CHANGE_PAGES,
  readDriveSyncToken,
  writeDriveSyncToken,
} from "@/lib/offline/drive/drive-file-node-changes";

export type DriveInboundSyncResult = {
  changed: boolean;
  /**
   * `FileNode/changes` listed at least one node, placed in the cache or not.
   * A node under a share rooted in someone else's tree has no cache path, but
   * an open listing of that folder still shows the change (#1663).
   */
  listedChanges: boolean;
  usedFullResync: boolean;
  /** Paths left in place because they still have unsaved collab work. */
  keptUnsavedPaths: string[];
};

const inFlight = new Map<string, Promise<DriveInboundSyncResult>>();

/**
 * FileNode/changes inbound. Created and updated rows are upserted by `nodeId`.
 * A path change migrates the cache row (and its sidecars) onto the new path.
 * `destroyed` drops the drive row, the pin, and the collab database unless
 * `PENDING_SERVER_SAVE_KEY` is set — then all three stay.
 *
 * App open, reconnect and settings change call only this: `FileNode/changes`.
 * No stored token, or `cannotCalculateChanges` (including a device past the
 * 30-day tombstone horizon), runs the full tree sync (`syncDriveTree`), which
 * stores the token itself. It never calls changes from `"0"`.
 */
export function syncDriveInboundFromFileNodes(
  username: string,
  options?: { signal?: AbortSignal },
): Promise<DriveInboundSyncResult> {
  if (!username) {
    return Promise.resolve({
      changed: false,
      listedChanges: false,
      usedFullResync: false,
      keptUnsavedPaths: [],
    });
  }
  const existing = inFlight.get(username);
  if (existing) return existing;
  const run = runDriveInbound(username, options).finally(() => {
    if (inFlight.get(username) === run) inFlight.delete(username);
  });
  inFlight.set(username, run);
  return run;
}

/** Resolves once the sync already running for `username`, if any, has settled. */
export async function settleDriveInbound(username: string): Promise<void> {
  await inFlight.get(username)?.catch(() => undefined);
}

async function runDriveInbound(
  username: string,
  options?: { signal?: AbortSignal },
): Promise<DriveInboundSyncResult> {
  if (!getConnectivitySnapshot()) {
    return { changed: false, listedChanges: false, usedFullResync: false, keptUnsavedPaths: [] };
  }
  const since = await readDriveSyncToken(username);
  if (since === null) return fullResync(username, null, options?.signal);
  const session = await driveJmapSession();
  try {
    const drained = await drainFileNodeChanges(session, since, options?.signal);
    if (options?.signal?.aborted) {
      return { changed: false, listedChanges: false, usedFullResync: false, keptUnsavedPaths: [] };
    }
    const kept = await applyFileNodeChanges(username, session, drained, options?.signal);
    const listedChanges =
      drained.created.length + drained.updated.length + drained.destroyed.length > 0;
    if (options?.signal?.aborted) {
      return {
        changed: kept.changed,
        listedChanges,
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
      listedChanges,
      usedFullResync: false,
      keptUnsavedPaths: kept.keptUnsavedPaths,
    };
  } catch (error) {
    if (!isCannotCalculateChanges(error)) throw error;
    return fullResync(username, since, options?.signal);
  }
}

/** `staleToken`: the token that failed (null when there was none). */
async function fullResync(
  username: string,
  staleToken: string | null,
  signal?: AbortSignal,
): Promise<DriveInboundSyncResult> {
  const before = await cachedPathsByNodeId(username);
  const tree = await syncDriveTree(username, { signal, ifTokenIs: staleToken });
  if (!tree.completed) {
    return {
      changed: true,
      listedChanges: true,
      usedFullResync: true,
      keptUnsavedPaths: tree.keptUnsavedPaths,
    };
  }
  // A full sync lists, it does not say what moved: the cached Docs views would keep a
  // renamed Doc at its old name (#1563). Until C4 removes those views, patch moves only.
  await applyDocsInboundChanges(username, await movesSince(username, before));
  return {
    changed: true,
    listedChanges: true,
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
  const docsChanges: DocsInboundChange[] = [];
  if (upsertIds.length > 0) {
    const got = await session.fileNodes.getFileNodes(session.accountId, upsertIds, { signal });
    const ordered = parentsBeforeChildren(got.list);
    const cachePaths = await cachedPathsByNodeId(username);
    const tree = {
      firstSyncDone: await readDriveTreeFirstSyncDone(username),
      roots: await readDriveTreeRoots(username),
    };
    for (const node of ordered) {
      const path =
        fileNodeVirtualPath(node) ??
        (await resolveNodePath(username, node, ordered, cachePaths, session, signal));
      if (!path) {
        console.warn("[drive-inbound] skipped FileNode with no resolvable path", { id: node.id });
        continue;
      }
      // `.notes`, `.attachments` and their contents are never list rows; one
      // moved in leaves the tree, before any path rewrite.
      if (isHiddenTreePath(path)) {
        const outcome = await dropCachedSubtree(username, cachePaths.get(node.id), docsChanges);
        keptUnsavedPaths.push(...outcome.kept);
        changed ||= outcome.dropped;
        cachePaths.delete(node.id);
        upserted.add(node.id);
        continue;
      }
      const previous = cachePaths.get(node.id);
      const placement = await moveCachedNodeToPath(username, node, path, cachePaths);
      if (placement === "blocked") {
        keptUnsavedPaths.push(normalizePath(path));
        blocked = true;
        continue;
      }
      const entry = fileNodeToDirectoryEntry(path, node);
      docsChanges.push(docsChangeFor(entry, placement === "moved" ? previous : undefined));
      await upsertDriveEntry(
        username,
        entry,
        await areaOfAppliedNode(username, node, path, cachePaths, tree),
      );
      await stampDocsAvailabilityNodeIds(username, [{ path, nodeId: node.id }]);
      await moveDocsAvailabilityForNode(username, node.id, path);
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
      docsChanges.push({ kind: "removed", path });
      changed = true;
    }
  }
  // Every cached Docs view follows; rows a queued Docs write owns stay (#1563).
  await applyDocsInboundChanges(username, docsChanges);
  return { changed, keptUnsavedPaths: [...new Set(keptUnsavedPaths)], blocked };
}

/**
 * Drop the cached row at `path` and every row below it (a node moved under a
 * dot folder). A Doc with unsaved work stays, as on a remote delete.
 */
async function dropCachedSubtree(
  username: string,
  path: string | undefined,
  docsChanges: DocsInboundChange[],
): Promise<{ dropped: boolean; kept: string[] }> {
  if (!path) return { dropped: false, kept: [] };
  const id = normalizePath(path);
  const kept: string[] = [];
  let dropped = false;
  for (const candidate of [...(await descendantIds(username, id)).reverse(), id]) {
    if ((await retainOrDropLocalDocument(username, candidate)) === "kept") {
      kept.push(candidate);
      continue;
    }
    await deleteDriveEntryByPath(username, candidate);
    docsChanges.push({ kind: "removed", path: candidate });
    dropped = true;
  }
  return { dropped, kept };
}

/**
 * `area` of a node the applier places: Trash by path, else its parent row's,
 * its account root's (roots have no row), or `share` for a node whose parent
 * is not in a complete tree. Undefined while the first sync has not finished.
 */
async function areaOfAppliedNode(
  username: string,
  node: JmapFileNode,
  path: string,
  cachePaths: ReadonlyMap<string, string>,
  tree: { firstSyncDone: boolean; roots: ReadonlyMap<string, string> },
): Promise<DriveEntryArea | undefined> {
  if (isTrashTreePath(path)) return "trash";
  if (!node.parentId) return areaForRoot(path, { kind: "account", path });
  const rootPath = tree.roots.get(node.parentId);
  if (rootPath) return areaForRoot(path, { kind: "account", path: rootPath });
  const parentPath = cachePaths.get(node.parentId);
  if (parentPath) return (await driveRowAt(username, parentPath))?.area;
  return tree.firstSyncDone ? "share" : undefined;
}

/** What Docs needs to know about one placed node: moved from `previous`, or upserted. */
function docsChangeFor(
  entry: Pick<WgwDriveDirectoryEntry, "type" | "path"> & Partial<WgwDriveDirectoryEntry>,
  previous?: string,
): DocsInboundChange {
  const node = {
    directory: entry.type === "dir",
    size: entry.size ?? 0,
    modifiedAt: entry.time ?? 0,
  };
  return previous
    ? { kind: "moved", from: previous, to: entry.path, node }
    : { kind: "upserted", path: entry.path, node };
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
    await migrateNodeSidecars(username, descendant, `${nextId}${suffix}`);
  }
  cachePaths.set(node.id, `/${nextId}`);
  return "moved";
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

/** Files the Drive cache now has at another path than in `before`, as Docs moves. */
async function movesSince(
  username: string,
  before: ReadonlyMap<string, string>,
): Promise<DocsInboundChange[]> {
  const moves: DocsInboundChange[] = [];
  const bare = (path: string): string => path.replace(/^\/+/, "");
  for (const [nodeId, from] of before) {
    // A Doc with unsaved text keeps its old row while the crawl upserts the new
    // path, so one node id can have several rows; the destination is the one
    // path that differs from `from`.
    const rows = await driveEntriesTable(accountDb(username))
      .where("nodeId")
      .equals(nodeId)
      .toArray();
    const others = new Set(rows.map((r) => bare(r.id)).filter((id) => id !== bare(from)));
    if (others.size !== 1) continue;
    const to = `/${[...others][0]}`;
    const row = await driveRowAt(username, to);
    // Each file carries its own from and to; a folder move would also drag along
    // children that were deleted or moved elsewhere in the same window.
    if (!row || row.type === "dir") continue;
    moves.push(docsChangeFor({ ...parseEntry(row.data), type: row.type, path: to }, from));
  }
  return moves;
}

function parseEntry(data: string): Partial<WgwDriveDirectoryEntry> {
  try {
    return JSON.parse(data) as Partial<WgwDriveDirectoryEntry>;
  } catch {
    return {};
  }
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
