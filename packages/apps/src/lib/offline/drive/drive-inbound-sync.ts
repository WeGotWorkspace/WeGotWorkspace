import {
  driveJmapSession,
  fileNodeToDirectoryEntry,
  fileNodeVirtualPath,
} from "@/lib/api/wgw/drive-jmap";
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
  deleteLeavingRow,
  planPrefixMoves,
  rowsUnderOldPaths,
  writePrefixMoves,
  type PathMove,
} from "@/lib/offline/drive/drive-applier-moves";
import { inDriveTreeTransaction, SidecarMoves } from "@/lib/offline/drive/drive-sidecar-moves";
import {
  areaForRoot,
  areaFromCrawledPath,
  isHiddenTreePath,
  isTrashTreePath,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";
import {
  readDriveTreeFirstSyncDone,
  readDriveTreeLastPass,
  readDriveTreeRoots,
  syncDriveTree,
} from "@/lib/offline/drive/drive-tree-sync";
import { moveDocsPageSetupOverrides } from "@/lib/docs-page-setup";

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
  // A device that only crawled folders walks the tree once, when the server offers the keyset.
  if (session.treeKeyset && (await readDriveTreeLastPass(username)) !== "tree") {
    return fullResync(username, since, options?.signal);
  }
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
  // Final paths of the rows this batch keeps: a deleted node's old path that
  // another node now holds is not cleared.
  const landed = new Set<string>();
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
    // Each batch node's cached path before this batch, and the rows under it then.
    const snapshot = new Map(cachePaths);
    const leaving = ordered.flatMap((node) => {
      const before = snapshot.get(node.id);
      const after = finalPaths.get(node.id);
      return before && after && normalizePath(before) !== normalizePath(after)
        ? [normalizePath(before)]
        : [];
    });
    const under = await rowsUnderOldPaths(username, leaving);
    const movingAway = new Set(under.map((row) => row.id));

    // Decide everything first. Only these reads leave the offline database
    // (unsaved collab work), so the writes below can share one transaction.
    const moves: PathMove[] = [];
    const placements: Placement[] = [];
    const occupantDrops: string[] = [];
    let leftTree: string[] = [];
    for (const node of ordered) {
      const path = finalPaths.get(node.id);
      if (!path) {
        console.warn("[drive-inbound] skipped FileNode with no resolvable path", { id: node.id });
        continue;
      }
      const previous = snapshot.get(node.id);
      const from = previous ? normalizePath(previous) : null;
      const to = normalizePath(path);
      upserted.add(node.id);
      // `.notes`, `.attachments` and their contents are never list rows: a node
      // moved in leaves the tree, and so do its cached descendants.
      if (isHiddenTreePath(path)) {
        if (from) {
          leftTree.push(from);
          moves.push({ from, to });
        }
        continue;
      }
      if (!from || from === to) {
        placements.push({ node, path });
        continue;
      }
      const occupant = await driveRowAt(username, to);
      // A batch node or a row under a moved folder at this path is moving away itself.
      if (
        occupant?.nodeId &&
        occupant.nodeId !== node.id &&
        !batchIds.has(occupant.nodeId) &&
        !movingAway.has(occupant.id)
      ) {
        if ((await retainOrDropLocalDocument(username, occupant.id)) === "kept") {
          upserted.delete(node.id);
          keptUnsavedPaths.push(to);
          blocked = true;
          continue;
        }
        occupantDrops.push(occupant.id);
      }
      const move: PathMove = { from, to };
      moves.push(move);
      placements.push({ node, path, previous: from, move });
    }
    const prefix = planPrefixMoves(under, moves, batchIds);
    const destinations: Set<string> = new Set([
      ...placements.map(({ path }) => normalizePath(path)),
      ...prefix.moved.map(({ id }) => id),
    ]);
    for (const path of destinations) landed.add(path);
    const kept = await keepUnsaved(username, [...leftTree, ...prefix.hidden]);
    keptUnsavedPaths.push(...kept);
    leftTree = [...leftTree, ...prefix.hidden].filter((path) => !kept.includes(path));
    for (const path of leftTree) {
      // Another node landing on that path keeps its Docs row.
      if (!destinations.has(path)) docsChanges.push({ kind: "removed", path: `/${path}` });
    }

    // Rows, blobs and pins commit together: a sync stopped halfway replays from
    // rows and sidecars that still agree (the token moves only after this).
    await inDriveTreeTransaction(username, async () => {
      const sidecars = new SidecarMoves();
      const table = driveEntriesTable(accountDb(username));
      for (const id of occupantDrops) await deleteDriveEntryByPath(username, id);
      for (const { node, path, previous, move } of placements) {
        if (previous && move) {
          sidecars.add(previous, move.to);
          if ((await table.get(previous))?.nodeId === node.id && !destinations.has(previous)) {
            await table.delete(previous);
          }
          cachePaths.set(node.id, `/${move.to}`);
        }
        const area = await areaOfAppliedNode(username, node, path, cachePaths, tree);
        if (move) move.area = area;
        const entry = fileNodeToDirectoryEntry(path, node);
        // Docs gets one `moved` per relocated file; a folder move is not expanded over them.
        if (!move || entry.type !== "dir") {
          docsChanges.push(docsChangeFor(entry, move ? `/${move.from}` : undefined));
        }
        await upsertDriveEntry(username, entry, area);
        cachePaths.set(node.id, path);
      }
      await writePrefixMoves(username, prefix.moved, destinations, sidecars, docsChanges);
      for (const path of leftTree) await deleteLeavingRow(username, path, destinations);
      await sidecars.apply(username);
      const placed = placements.map(({ node, path }) => ({ path, nodeId: node.id }));
      await stampDocsAvailabilityNodeIds(username, placed);
      for (const { path, nodeId } of placed) {
        await moveDocsAvailabilityForNode(username, nodeId, path);
      }
    });
    changed ||= placements.length + prefix.moved.length + leftTree.length > 0;
    moveDocsPageSetupOverrides(
      moves
        .filter((move) => !isHiddenTreePath(move.to))
        .map((move) => ({ from: `/${move.from}`, to: `/${move.to}` })),
    );
  }

  for (const id of changes.destroyed) {
    if (upserted.has(id)) continue;
    const paths = await pathsForNodeId(username, id);
    if (paths.length === 0) continue;
    for (const path of paths) {
      // A path another node now holds is not this node's to delete. The
      // destroyed node's own row (also one a prefix move relocated) always is.
      const holder = (await driveRowAt(username, path))?.nodeId;
      if (holder ? holder !== id : landed.has(normalizePath(path))) continue;
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
 * `area` of a node the applier places: Trash by path, else its parent row's,
 * its account root's (roots have no row), or `share` for a node whose parent
 * is not in a complete tree. Undefined while the first sync has not finished.
 */
async function areaOfAppliedNode(
  username: string,
  node: JmapFileNode,
  path: string,
  cachePaths: ReadonlyMap<string, string>,
  tree: { firstSyncDone: boolean; roots: ReadonlyMap<string, string> | null },
): Promise<DriveEntryArea | undefined> {
  if (isTrashTreePath(path)) return "trash";
  if (!node.parentId) return areaForRoot(path, { kind: "account", path });
  const rootPath = tree.roots?.get(node.parentId);
  if (rootPath) return areaForRoot(path, { kind: "account", path: rootPath });
  const parentPath = cachePaths.get(node.parentId);
  if (parentPath) return (await driveRowAt(username, parentPath))?.area;
  if (!tree.firstSyncDone) return undefined;
  // Only a tree pass knows the root ids; after the per-folder crawl (home and
  // team drives only) the path decides.
  return tree.roots ? "share" : areaFromCrawledPath(path);
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

type Placement = {
  node: JmapFileNode;
  path: string;
  /** The node's cached path before this batch, when it moves. */
  previous?: string;
  move?: PathMove;
};

/** Paths of `paths` whose Doc still has unsaved work: they stay. The rest drop their pin and local text. */
async function keepUnsaved(username: string, paths: readonly string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const path of paths) {
    if ((await retainOrDropLocalDocument(username, path)) === "kept") kept.push(path);
  }
  return kept;
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

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}
