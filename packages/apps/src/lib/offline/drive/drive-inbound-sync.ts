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
  areaFromCrawledPath,
  isTrashTreePath,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";
import {
  migrateNodeSidecars,
  readDriveTreeFirstSyncDone,
  readDriveTreeRoots,
  syncDriveTree,
} from "@/lib/offline/drive/drive-tree-sync";
import { moveDocsPageSetupOverride } from "@/lib/docs-page-setup";

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
    const nodes = await getInBatches(session, upsertIds, signal);
    const ordered = parentsBeforeChildren(nodes);
    const cachePaths = await cachedPathsByNodeId(username);
    const tree = {
      firstSyncDone: await readDriveTreeFirstSyncDone(username),
      roots: await readDriveTreeRoots(username),
    };
    const finalPaths = await finalPathsOf(username, ordered, cachePaths, session, signal);
    const batchIds = new Set(ordered.map((node) => node.id));
    // Each moved node's cached path, so the rows still under it follow afterwards.
    const moves: Array<{ from: string; to: string; area?: DriveEntryArea }> = [];
    for (const node of ordered) {
      const path = finalPaths.get(node.id);
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
      const placement = await placeNodeAtPath(username, node, path, cachePaths, batchIds);
      if (placement === "blocked") {
        keptUnsavedPaths.push(normalizePath(path));
        blocked = true;
        continue;
      }
      const area = await areaOfAppliedNode(username, node, path, cachePaths, tree);
      if (placement === "moved" && previous) {
        moves.push({ from: normalizePath(previous), to: normalizePath(path), area });
      }
      const entry = fileNodeToDirectoryEntry(path, node);
      docsChanges.push(docsChangeFor(entry, placement === "moved" ? previous : undefined));
      await upsertDriveEntry(username, entry, area);
      await stampDocsAvailabilityNodeIds(username, [{ path, nodeId: node.id }]);
      await moveDocsAvailabilityForNode(username, node.id, path);
      cachePaths.set(node.id, path);
      upserted.add(node.id);
      changed = true;
    }
    await moveRowsUnderMovedPaths(username, moves, batchIds);
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
  if (!tree.firstSyncDone) return undefined;
  // Without a root map (a pass that never recorded one) a parentless-in-cache node is not known to be a share.
  return tree.roots.size > 0 ? "share" : areaFromCrawledPath(path);
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

/** `updated` and `created` in `maxObjectsInGet` batches: a large subtree can arrive at once. */
async function getInBatches(
  session: Awaited<ReturnType<typeof driveJmapSession>>,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<JmapFileNode[]> {
  const size = session.maxObjectsInGet ?? 500;
  const nodes: JmapFileNode[] = [];
  for (let index = 0; index < ids.length; index += size) {
    const got = await session.fileNodes.getFileNodes(
      session.accountId,
      ids.slice(index, index + size),
      { signal },
    );
    nodes.push(...got.list);
  }
  return nodes;
}

/**
 * Final path of every node in the batch, as the tree walk resolves it: a node
 * whose parent is in the batch gets the parent's final path plus its own name;
 * otherwise the `path` from `FileNode/get` (share roots included). A server
 * without `path` falls back to the cached parent chain. A repeated id in a
 * chain is a cycle: that node is skipped.
 */
async function finalPathsOf(
  username: string,
  ordered: readonly JmapFileNode[],
  cachePaths: Map<string, string>,
  session: Awaited<ReturnType<typeof driveJmapSession>>,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const paths = new Map<string, string>();
  const resolve = async (node: JmapFileNode, seen: Set<string>): Promise<string | null> => {
    const known = paths.get(node.id);
    if (known) return known;
    if (seen.has(node.id)) return null;
    seen.add(node.id);
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    let path: string | null;
    if (parent) {
      const parentPath = await resolve(parent, seen);
      path = parentPath ? `${parentPath.replace(/\/$/, "")}/${node.name}` : null;
    } else {
      path =
        fileNodeVirtualPath(node) ??
        (await resolveNodePath(username, node, ordered, cachePaths, session, signal));
    }
    if (path) paths.set(node.id, path);
    return path;
  };
  for (const node of ordered) await resolve(node, new Set());
  return paths;
}

/**
 * Move one node's own cached row, blob and pins to `nextPath`. Rows below its
 * old path are not touched here: {@link moveRowsUnderMovedPaths} moves them
 * once every node of the batch is placed, so nested renames in one batch land
 * at the inner path.
 */
async function placeNodeAtPath(
  username: string,
  node: JmapFileNode,
  nextPath: string,
  cachePaths: Map<string, string>,
  batchIds: ReadonlySet<string>,
): Promise<"moved" | "unchanged" | "blocked"> {
  const current = cachePaths.get(node.id);
  const nextId = normalizePath(nextPath);
  if (!current) return "unchanged";
  const oldId = normalizePath(current);
  if (oldId === nextId) return "unchanged";
  const occupant = await driveRowAt(username, nextId);
  // A batch node at this path is moving away itself; its own placement handles it.
  if (occupant?.nodeId && occupant.nodeId !== node.id && !batchIds.has(occupant.nodeId)) {
    const occupantOutcome = await retainOrDropLocalDocument(username, occupant.id);
    if (occupantOutcome === "kept") return "blocked";
    await deleteDriveEntryByPath(username, occupant.id);
  }
  await migrateNodeSidecars(username, oldId, nextId);
  const table = driveEntriesTable(accountDb(username));
  if ((await table.get(oldId))?.nodeId === node.id) await table.delete(oldId);
  cachePaths.set(node.id, `/${nextId}`);
  return "moved";
}

/**
 * After every node of a batch is placed: for each moved node's old path,
 * longest first, every other cached row still under it (descendants the batch
 * did not list, upload placeholders) gets the new prefix, with its blob and
 * pins, and the old row goes. A moved row takes `trash` under `.Trash`, else
 * the area decided for the moved node. Docs page setup follows in the same
 * order, so a nested rename finds the inner key still at its old path.
 */
async function moveRowsUnderMovedPaths(
  username: string,
  moves: readonly { from: string; to: string; area?: DriveEntryArea }[],
  batchIds: ReadonlySet<string>,
): Promise<void> {
  const table = driveEntriesTable(accountDb(username));
  const ordered = [...moves].sort((a, b) => b.from.length - a.from.length);
  for (const { from, to, area } of ordered) {
    moveDocsPageSetupOverride(`/${from}`, `/${to}`);
    const under = await table.where("id").startsWith(`${from}/`).toArray();
    for (const row of under) {
      if (row.nodeId && batchIds.has(row.nodeId)) continue;
      const id = `${to}${row.id.slice(from.length)}`;
      const entry = parseEntry(row.data);
      const parentPath = normalizePath(parentAndName(`/${id}`).destination);
      await table.put({
        ...row,
        id,
        area: isTrashTreePath(id) ? "trash" : (area ?? row.area),
        parentPath,
        data: JSON.stringify({ ...entry, path: `/${id}` }),
      });
      await table.delete(row.id);
      await migrateNodeSidecars(username, row.id, id);
    }
  }
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
