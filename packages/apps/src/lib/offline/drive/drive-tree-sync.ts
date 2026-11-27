import {
  driveJmapSession,
  fileNodeToDirectoryEntry,
  fileNodeVirtualPath,
  type DriveJmapSession,
} from "@/lib/api/wgw/drive-jmap";
import { fetchFileNodeTreeBatch, type FileNodeTreePage } from "@/lib/api/wgw/drive-jmap-tree";
import { fetchDriveSharedWithMe } from "@/lib/api/wgw/drive-shares";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveAppBootstrap } from "@/lib/files/drive-types";
import { normalizeApiVirtualPath as normalizePath } from "@/lib/files/api-path";
import type { JmapFileNode } from "@/lib/jmap-client";
import {
  backgroundSyncPacer,
  isRateLimitedError,
  retryAfterMsFromError,
} from "@/lib/offline/core/background-sync-pacer";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { stampDocsAvailabilityNodeIds } from "@/lib/offline/docs/docs-availability-store";
import {
  normalizeDriveEntryPath,
  readDriveBootstrapFromCache,
  upsertDriveEntriesInBulk,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { pruneDriveEntriesToKeepSet } from "@/lib/offline/drive/drive-fetched-set-prune";
import {
  drainFileNodeChanges,
  isCannotCalculateChanges,
  readDriveSyncToken,
  writeDriveSyncToken,
} from "@/lib/offline/drive/drive-file-node-changes";
import { syncDriveMetadataTree } from "@/lib/offline/drive/drive-metadata-sync";
import { inDriveTreeTransaction, SidecarMoves } from "@/lib/offline/drive/drive-sidecar-moves";
import {
  driveEntriesTable,
  driveTreeStagingTable,
  type OfflineDriveTreeStagingRow,
} from "@/lib/offline/drive/drive-schema";
import {
  areaForRoot,
  areaFromCrawledPath,
  isHiddenTreePath,
  type DriveEntryArea,
} from "@/lib/offline/drive/drive-tree-rows";
import { rememberDriveFolderNodeId } from "@/lib/offline/drive/upload/drive-upload-target";

/** Meta key of the walk in progress: its starting state and `node_id` cursor. */
export const DRIVE_TREE_CURSOR_KEY = "drive:tree-sync:cursor";
/** Meta key set once the first complete tree sync on this device has finished. */
export const DRIVE_TREE_FIRST_SYNC_DONE_KEY = "drive:tree-sync:first-done";
/** Meta key: FileNode id → path of the person's account roots (home, team drives). */
export const DRIVE_TREE_ROOTS_KEY = "drive:tree-sync:roots";
/**
 * Meta key: how the last complete pass ran, `"tree"` (keyset walk) or
 * `"crawl"` (per-folder fallback). A device that only crawled walks the tree
 * once the server offers the keyset.
 */
export const DRIVE_TREE_LAST_PASS_KEY = "drive:tree-sync:last-pass";
/**
 * Meta key: JSON list of the account root paths the per-folder crawl queued
 * (home and the team drives `/groups` listed). Not the roots map: a non-null
 * map tells the applier a keyset pass ran. Removed by a tree pass.
 */
export const DRIVE_TREE_CRAWL_ROOTS_KEY = "drive:tree-sync:crawl-roots";
/** A pass restarted by `cannotCalculateChanges` more often than this waits for the next sync. */
const MAX_PASSES = 3;

/**
 * The walk in progress. `state` is the state taken before page 1: every page
 * is limited to nodes that existed then (`asOfState`), and the catch-up runs
 * `FileNode/changes` from it. `idAfter` is the last `node_id` staged.
 */
type TreeCursor = { state: string; idAfter: string | null; walkDone: boolean };

export type DriveTreeSyncResult = {
  /** The tree is complete and the token current. */
  completed: boolean;
  /** Rows were written or removed. */
  changed: boolean;
  /** Paths left in place because they still have unsaved collab work. */
  keptUnsavedPaths: string[];
};

const NOTHING: DriveTreeSyncResult = { completed: false, changed: false, keptUnsavedPaths: [] };

/**
 * Account roots of the last complete tree pass, FileNode id → path. They have
 * no row of their own, so the change applier reads their area from here. Null
 * when no tree pass wrote them (the per-folder crawl does not).
 */
export async function readDriveTreeRoots(username: string): Promise<Map<string, string> | null> {
  const raw = await readMeta(username, DRIVE_TREE_ROOTS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(
      Object.entries(parsed).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    );
  } catch {
    return null;
  }
}

/** The account root paths of the last crawl, or null when no crawl stored them. */
export async function readDriveTreeCrawlRoots(username: string): Promise<string[] | null> {
  const raw = await readMeta(username, DRIVE_TREE_CRAWL_ROOTS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string => typeof path === "string")
      : null;
  } catch {
    return null;
  }
}

export async function readDriveTreeLastPass(username: string): Promise<"tree" | "crawl" | null> {
  const value = await readMeta(username, DRIVE_TREE_LAST_PASS_KEY);
  return value === "tree" || value === "crawl" ? value : null;
}

export async function readDriveTreeFirstSyncDone(username: string): Promise<boolean> {
  return (await readMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY)) === "1";
}

/**
 * Fill or rebuild the device's file tree (#2063 C1): home, team drives, Trash
 * and the roots shared with the person, in a few batched requests. One tab at
 * a time (Web Lock); a refresh resumes from the stored cursor.
 *
 * `ifTokenIs`: run only while the stored `FileNode/changes` token is still this
 * one. A tab that waited for the lock while another tab finished a pass then
 * finds a new token and does not start a second pass.
 *
 * On a server without the keyset (#2063 S1) it keeps the per-folder crawl and
 * never pages by position.
 */
export function syncDriveTree(
  username: string,
  options?: { signal?: AbortSignal; ifTokenIs?: string | null },
): Promise<DriveTreeSyncResult> {
  if (!username || !getConnectivitySnapshot()) return Promise.resolve(NOTHING);
  return withCrossTabLock(`wgw.drive.tree-sync.${username}`, async () => {
    if (options && options.ifTokenIs !== undefined && !(await readCursor(username))) {
      const token = await readDriveSyncToken(username);
      if (token !== null && token !== options.ifTokenIs) {
        return { completed: true, changed: false, keptUnsavedPaths: [] };
      }
    }
    const session = await driveJmapSession();
    if (!session.treeKeyset) return crawlFolders(username, session, options?.signal);
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const outcome = await runTreePass(username, session, options?.signal);
      if (outcome !== "restart") return outcome;
    }
    return NOTHING;
  });
}

/**
 * Servers without the keyset: one listing per folder. The token is the state
 * taken before the first listing, so a change made while the crawl runs comes
 * back through `FileNode/changes` on the next sync.
 */
async function crawlFolders(
  username: string,
  session: DriveJmapSession,
  signal?: AbortSignal,
): Promise<DriveTreeSyncResult> {
  const before = await session.fileNodes.getFileNodes(session.accountId, [], { signal });
  const bootstrap = (await readDriveBootstrapFromCache(username)) ?? fallbackBootstrap(username);
  // Null when the crawl returned before queueing roots (it went offline first).
  let crawlRoots: readonly string[] | null = null;
  const progress = await syncDriveMetadataTree(username, bootstrap, {
    signal,
    onRoots: (roots) => {
      crawlRoots = roots;
    },
  });
  if (signal?.aborted || progress.failed > 0) {
    return { completed: false, changed: true, keptUnsavedPaths: [] };
  }
  // The crawl lists the person's own drives; the share roots come from the
  // shared-with-me list, so Shared with me reads the tree there too. A failing
  // list does not hold the first sync back: the person's own drives are done.
  try {
    const shared = await fetchDriveSharedWithMe({ signal });
    await upsertDriveEntriesInBulk(
      username,
      shared.map((item) => ({ entry: item.entry as WgwDriveDirectoryEntry, area: "share" })),
    );
  } catch {
    if (signal?.aborted) return { completed: false, changed: true, keptUnsavedPaths: [] };
  }
  // The crawl knows no root ids; the applier then reads `area` from the path.
  await accountDb(username).meta.delete(DRIVE_TREE_ROOTS_KEY);
  await stampCrawledAreas(username);
  // A crawl that returned before queueing roots keeps the list it had: an empty
  // one would make every account root not-available until the next crawl.
  if (crawlRoots) {
    await writeMeta(username, DRIVE_TREE_CRAWL_ROOTS_KEY, JSON.stringify(crawlRoots));
  }
  await writeDriveSyncToken(username, before.state);
  await writeMeta(username, DRIVE_TREE_LAST_PASS_KEY, "crawl");
  await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  return { completed: true, changed: true, keptUnsavedPaths: [] };
}

/**
 * The crawl writes rows through `upsertDriveEntry`, which takes a parent row's
 * area, and account roots have no row, so crawled rows have none. The crawl
 * never stores share roots, so the path decides the area, as in the Dexie
 * backfill. Area-indexed views (All files, Recent, Trash) need it.
 */
async function stampCrawledAreas(username: string): Promise<void> {
  await driveEntriesTable(accountDb(username))
    .filter((row) => row.area === undefined)
    .modify((row) => {
      row.area = areaFromCrawledPath(row.id);
    });
}

/**
 * One pass: the keyset walk (resumed when a cursor is stored), then the
 * catch-up, path resolution, write and prune. `"restart"` after
 * `cannotCalculateChanges`: rows stay, no prune, no token, new pass.
 */
async function runTreePass(
  username: string,
  session: DriveJmapSession,
  signal?: AbortSignal,
): Promise<DriveTreeSyncResult | "restart"> {
  const pacer = backgroundSyncPacer();
  const paced = async <T>(request: () => Promise<T>): Promise<T> => {
    await pacer.acquire(signal, "first");
    try {
      const result = await request();
      pacer.reportSuccess();
      return result;
    } catch (error) {
      if (isRateLimitedError(error)) pacer.reportRateLimited(retryAfterMsFromError(error));
      throw error;
    }
  };

  let cursor = await readCursor(username);
  if (!cursor) await stagingTable(username).clear();
  let changed = false;
  while (!cursor?.walkDone) {
    if (signal?.aborted) return { ...NOTHING, changed };
    const batch = await paced(() =>
      fetchFileNodeTreeBatch(
        session,
        { asOfState: cursor?.state ?? null, idAfter: cursor?.idAfter ?? null },
        signal,
      ),
    );
    const next: TreeCursor | null =
      cursor ?? (batch.state ? { state: batch.state, idAfter: null, walkDone: false } : null);
    if (!next) return { ...NOTHING, changed };
    if (batch.pages.length > 0) {
      await stagePages(username, batch.pages);
      changed = true;
      next.idAfter = lastId(batch.pages) ?? next.idAfter;
    }
    next.walkDone = batch.done;
    // Staged first, cursor second: a crash between them fetches those pages again.
    await writeCursor(username, next);
    cursor = next;
    // A hole: keep the tree and the token as they are; the retry starts at that page.
    if (batch.failed) return { ...NOTHING, changed };
  }

  const startState = cursor.state;
  let drained;
  try {
    drained = await drainFileNodeChanges(session, startState, signal, () =>
      pacer.acquire(signal, "first"),
    );
  } catch (error) {
    if (!isCannotCalculateChanges(error)) throw error;
    await clearPass(username);
    return "restart";
  }
  if (signal?.aborted) return { ...NOTHING, changed };
  await applyCatchUp(username, session, drained, paced, signal);
  if (signal?.aborted) return { ...NOTHING, changed };

  const keptUnsavedPaths = await writeResolvedTree(username);
  // Cursor first: a crash before the token is written starts a fresh pass.
  await clearCursor(username);
  await writeDriveSyncToken(username, drained.newState);
  await stagingTable(username).clear();
  await accountDb(username).meta.delete(DRIVE_TREE_CRAWL_ROOTS_KEY);
  await writeMeta(username, DRIVE_TREE_LAST_PASS_KEY, "tree");
  await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  return { completed: true, changed: true, keptUnsavedPaths };
}

/** The last `node_id` of the batch's pages; null when every page was empty. */
function lastId(pages: readonly FileNodeTreePage[]): string | null {
  let last: string | null = null;
  for (const page of pages) {
    if (page.ids.length > 0) last = page.ids[page.ids.length - 1]!;
  }
  return last;
}

/**
 * Record the pages in the staging table (dot paths included), and upsert the
 * list rows among them at the server's path so rows that already arrived show.
 */
async function stagePages(username: string, pages: readonly FileNodeTreePage[]): Promise<void> {
  const nodes = pages.flatMap((page) => page.nodes);
  const staged = await stageNodes(username, nodes);
  const visible = staged
    .filter((row) => row.parentId !== null && !isHiddenTreePath(row.path))
    .map((row) => ({ entry: parseEntry(row.data) }));
  await upsertDriveEntriesInBulk(username, visible, { skipOtherNodes: true });
}

async function stageNodes(
  username: string,
  nodes: readonly JmapFileNode[],
): Promise<OfflineDriveTreeStagingRow[]> {
  const rows: OfflineDriveTreeStagingRow[] = [];
  for (const node of nodes) {
    const path = fileNodeVirtualPath(node);
    if (!path) {
      console.warn("[drive-tree] FileNode/get returned no path", { id: node.id });
      continue;
    }
    rows.push({
      nodeId: node.id,
      parentId: node.parentId ?? null,
      name: node.name,
      path,
      data: JSON.stringify(fileNodeToDirectoryEntry(path, node)),
    });
  }
  await stagingTable(username).bulkPut(rows);
  return rows;
}

/**
 * `FileNode/changes` from the pre-page-1 state, applied to the staging set:
 * `destroyed` removed, `created` and `updated` fetched (in `maxObjectsInGet`
 * chunks) with their new parent, name and path. A node created and deleted
 * during the walk is never staged.
 */
async function applyCatchUp(
  username: string,
  session: DriveJmapSession,
  drained: { created: string[]; updated: string[]; destroyed: string[] },
  paced: <T>(request: () => Promise<T>) => Promise<T>,
  signal?: AbortSignal,
): Promise<void> {
  const staging = stagingTable(username);
  const destroyed = new Set(drained.destroyed);
  await staging.bulkDelete([...destroyed]);
  const ids = [...new Set([...drained.created, ...drained.updated])].filter(
    (id) => !destroyed.has(id),
  );
  const chunk = session.maxObjectsInGet ?? 500;
  for (let index = 0; index < ids.length; index += chunk) {
    const part = ids.slice(index, index + chunk);
    const got = await paced(() =>
      session.fileNodes.getFileNodes(session.accountId, part, { signal }),
    );
    await stageNodes(username, got.list);
    await staging.bulkDelete(got.notFound ?? []);
  }
}

type ResolvedTreeNode = {
  path: string;
  root: { kind: "account"; path: string } | { kind: "share" };
};

/**
 * Final path of every staging row: a node whose parent is staged gets the
 * parent's resolved path plus its own name (never the parent's stored server
 * path, which is stale under a renamed ancestor); a node whose parent is not
 * staged (account root, share root) keeps its server path. Order-independent.
 * A repeated id in a chain is a cycle: that row is skipped instead of
 * hanging. A deep acyclic chain is kept.
 */
export function resolveTreePaths(
  rows: readonly OfflineDriveTreeStagingRow[],
): Map<string, ResolvedTreeNode> {
  const byId = new Map(rows.map((row) => [row.nodeId, row]));
  const resolved = new Map<string, ResolvedTreeNode>();
  for (const row of rows) {
    if (resolved.has(row.nodeId)) continue;
    const chain: OfflineDriveTreeStagingRow[] = [];
    const onChain = new Set<string>();
    let base: ResolvedTreeNode | undefined;
    let current: OfflineDriveTreeStagingRow | undefined = row;
    let broken = false;
    while (current) {
      base = resolved.get(current.nodeId);
      if (base) break;
      if (onChain.has(current.nodeId)) {
        broken = true;
        break;
      }
      chain.push(current);
      onChain.add(current.nodeId);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (broken) {
      console.warn("[drive-tree] skipped a FileNode with a parent cycle", { id: row.nodeId });
      continue;
    }
    let index = chain.length - 1;
    if (!base) {
      const top = chain[index]!;
      const path = normalizePath(top.path);
      base = {
        path,
        root: top.parentId === null ? { kind: "account", path } : { kind: "share" },
      };
      resolved.set(top.nodeId, base);
      index -= 1;
    }
    for (; index >= 0; index -= 1) {
      const node = chain[index]!;
      base = { path: `${base.path.replace(/\/$/, "")}/${node.name}`, root: base.root };
      resolved.set(node.nodeId, base);
    }
  }
  return resolved;
}

/**
 * After the catch-up: resolve every staging row's final path, drop dot paths
 * (except `.Trash`), move each node's blob and pins from its previous path,
 * upsert the rows with their `area`, then prune everything else.
 */
async function writeResolvedTree(username: string): Promise<string[]> {
  const staged = await stagingTable(username).toArray();
  const resolved = resolveTreePaths(staged);
  const finals: Array<{ entry: WgwDriveDirectoryEntry; area: DriveEntryArea }> = [];
  const roots: Record<string, string> = {};
  for (const row of staged) {
    const node = resolved.get(row.nodeId);
    if (!node) continue;
    if (row.parentId === null) {
      // Account roots have no row of their own; remember their ids so files can be queued into them.
      await rememberDriveFolderNodeId(username, node.path, row.nodeId);
      roots[row.nodeId] = node.path;
      continue;
    }
    if (isHiddenTreePath(node.path)) continue;
    finals.push({
      entry: { ...parseEntry(row.data), path: node.path, name: row.name },
      area: areaForRoot(node.path, node.root),
    });
  }

  await writeMeta(username, DRIVE_TREE_ROOTS_KEY, JSON.stringify(roots));
  // Rows, blobs and pins commit together: a pass stopped halfway resumes from
  // rows and sidecars that still agree.
  await inDriveTreeTransaction(username, async () => {
    await moveSidecarsOfMovedNodes(username, finals);
    await upsertDriveEntriesInBulk(username, finals);
  });
  const keep = new Set(finals.map(({ entry }) => normalizeDriveEntryPath(entry.path)));
  const pruned = await pruneDriveEntriesToKeepSet(username, keep);
  await stampDocsAvailabilityNodeIds(
    username,
    finals.map(({ entry }) => ({ path: entry.path, nodeId: entry.nodeId })),
  );
  return pruned.keptUnsavedPaths;
}

/**
 * A node that already had a row at another path takes that row's blob and
 * availability with it, per row, so a nested rename never leaves a blob on the
 * outer path. Two phases: a node renamed onto a path another node is leaving
 * never overwrites that node's blob. Runs before any final row is written.
 */
async function moveSidecarsOfMovedNodes(
  username: string,
  finals: readonly { entry: WgwDriveDirectoryEntry }[],
): Promise<void> {
  const rows = await driveEntriesTable(accountDb(username)).where("nodeId").above("").toArray();
  const previous = new Map<string, string[]>();
  for (const row of rows) {
    const list = previous.get(row.nodeId!) ?? [];
    list.push(row.id);
    previous.set(row.nodeId!, list);
  }
  const moves = new SidecarMoves();
  for (const { entry } of finals) {
    if (!entry.nodeId) continue;
    const target = normalizeDriveEntryPath(entry.path);
    for (const from of previous.get(entry.nodeId) ?? []) moves.add(from, target);
  }
  await moves.apply(username);
}

async function readCursor(username: string): Promise<TreeCursor | null> {
  const raw = await readMeta(username, DRIVE_TREE_CURSOR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TreeCursor>;
    if (typeof parsed.state !== "string") return null;
    return {
      state: parsed.state,
      idAfter: typeof parsed.idAfter === "string" ? parsed.idAfter : null,
      walkDone: parsed.walkDone === true,
    };
  } catch {
    return null;
  }
}

async function writeCursor(username: string, cursor: TreeCursor): Promise<void> {
  await writeMeta(username, DRIVE_TREE_CURSOR_KEY, JSON.stringify(cursor));
}

async function clearCursor(username: string): Promise<void> {
  await accountDb(username).meta.delete(DRIVE_TREE_CURSOR_KEY);
}

async function clearPass(username: string): Promise<void> {
  await clearCursor(username);
  await stagingTable(username).clear();
}

function parseEntry(data: string): WgwDriveDirectoryEntry {
  return JSON.parse(data) as WgwDriveDirectoryEntry;
}

function stagingTable(username: string) {
  return driveTreeStagingTable(accountDb(username));
}

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
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
