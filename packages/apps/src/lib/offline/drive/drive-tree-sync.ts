import {
  driveJmapSession,
  fileNodeToDirectoryEntry,
  FileNodeNotFoundError,
  fileNodeVirtualPath,
  listFileNodeEntries,
  type DriveJmapSession,
} from "@/lib/api/wgw/drive-jmap";
import { fetchFileNodeTreeBatch, type FileNodeTreePage } from "@/lib/api/wgw/drive-jmap-tree";
import { fetchDriveSharedWithMe } from "@/lib/api/wgw/drive-shares";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { moveDocsPageSetupOverrides, removeDocsPageSetupOverrides } from "@/lib/docs-page-setup";
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
import {
  pruneDriveEntriesToKeepSet,
  rememberKeptUnsavedDocuments,
} from "@/lib/offline/drive/drive-fetched-set-prune";
import {
  drainFileNodeChanges,
  isCannotCalculateChanges,
  readDriveSyncToken,
  writeDriveSyncToken,
} from "@/lib/offline/drive/drive-file-node-changes";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import {
  documentHasUnsavedLocalWork,
  retainOrDropLocalDocument,
} from "@/lib/offline/drive/drive-local-document";
import { applyFetchedDirectorySnapshot } from "@/lib/offline/drive/drive-fetched-set-prune";
import { syncDriveMetadataTree } from "@/lib/offline/drive/drive-metadata-sync";
import { inDriveTreeTransaction, SidecarMoves } from "@/lib/offline/drive/drive-sidecar-moves";
import {
  driveContentBlobsTable,
  driveEntriesTable,
  driveTreePrepassTable,
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
/**
 * Meta key set once the pre-pass `nodeId → path` map of the pass in progress
 * is stored, so a resume or a restart never takes it again from rows the walk
 * already upserted.
 */
const DRIVE_TREE_PREPASS_KEY = "drive:tree-sync:prepass";
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
  // `roots` stays null when the crawl returned before queueing roots (it went offline first).
  const queued: { roots: readonly string[] | null } = { roots: null };
  const progress = await syncDriveMetadataTree(username, bootstrap, {
    signal,
    onRoots: (roots) => {
      queued.roots = roots;
    },
  });
  if (signal?.aborted || progress.failed > 0) {
    return { completed: false, changed: true, keptUnsavedPaths: [] };
  }
  // `total` 0: the crawl did not run (offline before it queued anything). Write
  // nothing: a token and last-pass marker here would mark an empty tree as
  // complete, and a server without the keyset would not crawl again.
  if (progress.total === 0) return { completed: false, changed: false, keptUnsavedPaths: [] };
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
  if (!(await crawlTrash(username, session, queued.roots ?? [], signal))) {
    return { completed: false, changed: true, keptUnsavedPaths: [] };
  }
  // The crawl knows no root ids; the applier then reads `area` from the path.
  await accountDb(username).meta.delete(DRIVE_TREE_ROOTS_KEY);
  await clearPrepass(username);
  await stampCrawledAreas(username);
  // A crawl that returned before queueing roots keeps the list it had: an empty
  // one would make every account root not-available until the next crawl.
  if (queued.roots) {
    await writeMeta(username, DRIVE_TREE_CRAWL_ROOTS_KEY, JSON.stringify(queued.roots));
  }
  await writeDriveSyncToken(username, before.state);
  // Not `firstSyncDone`: the device walks the tree once the server offers the keyset.
  await writeMeta(username, DRIVE_TREE_LAST_PASS_KEY, "crawl");
  return { completed: true, changed: true, keptUnsavedPaths: [] };
}

/**
 * The crawl skips dot folders, so Trash would hold only what this device
 * trashed. List each root's `.Trash` (its top level: what the Trash view
 * shows) and store it, pruning what is gone. A root with no `.Trash` has an
 * empty Trash. Any other failure returns false: the crawl then stays
 * unfinished (no token, no last pass), so the first-sync retry runs it again.
 */
async function crawlTrash(
  username: string,
  session: DriveJmapSession,
  roots: readonly string[],
  signal?: AbortSignal,
): Promise<boolean> {
  for (const root of roots) {
    if (signal?.aborted) return false;
    const trash = `${normalizePath(root)}/.Trash`;
    let entries: WgwDriveDirectoryEntry[];
    try {
      entries = await listFileNodeEntries(session, trash, username, {
        includeHidden: true,
        signal,
      });
    } catch (error) {
      if (!(error instanceof FileNodeNotFoundError)) return false;
      entries = [];
    }
    await applyFetchedDirectorySnapshot(username, trash, entries);
  }
  return true;
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
  await takePrepassMap(username);
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

  const written = await writeResolvedTree(username);
  // An unsaved document holds a final path: nothing was written; the cursor and
  // the token stay, so the next sync replays the catch-up and retries.
  if (written.blocked) {
    return { completed: false, changed, keptUnsavedPaths: written.keptUnsavedPaths };
  }
  const keptUnsavedPaths = written.keptUnsavedPaths;
  // Cursor first: a crash before the token is written starts a fresh pass.
  await clearCursor(username);
  await writeDriveSyncToken(username, drained.newState);
  await stagingTable(username).clear();
  await accountDb(username).meta.delete(DRIVE_TREE_CRAWL_ROOTS_KEY);
  await writeMeta(username, DRIVE_TREE_LAST_PASS_KEY, "tree");
  await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  return { completed: true, changed: true, keptUnsavedPaths };
}

/**
 * Before page 1: where every node's rows are now. Pages upsert into
 * `drive_entries` during the walk, so relocation reads a node's original
 * paths from this map. Taken once per pass; a resume and a restart after
 * `cannotCalculateChanges` reuse it, since no blob or pin has moved yet. The
 * final write deletes it in the same transaction that moves the sidecars.
 */
async function takePrepassMap(username: string): Promise<void> {
  if ((await readMeta(username, DRIVE_TREE_PREPASS_KEY)) === "1") return;
  const db = accountDb(username);
  const rows = await driveEntriesTable(db).where("nodeId").above("").toArray();
  const blobs = await driveContentBlobsTable(db).bulkGet(rows.map((row) => row.id));
  // One path per node: when a node holds two rows, the one with the blob.
  const paths = new Map<string, string>();
  rows.forEach((row, index) => {
    if (!paths.has(row.nodeId!) || blobs[index]) paths.set(row.nodeId!, row.id);
  });
  const prepass = prepassTable(username);
  await prepass.clear();
  await prepass.bulkPut([...paths].map(([nodeId, path]) => ({ nodeId, paths: [path] })));
  await writeMeta(username, DRIVE_TREE_PREPASS_KEY, "1");
}

async function clearPrepass(username: string): Promise<void> {
  await accountDb(username).meta.delete(DRIVE_TREE_PREPASS_KEY);
  await prepassTable(username).clear();
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
 * A node the pre-pass map has is only refreshed where its row already is (same
 * path, same `nodeId`): it stays at its mapped path until the pass commits, so
 * a rename during the walk never forks it onto a second path. A node the map
 * lacks is inserted, never over another node's row. Either way a half-finished
 * walk never pairs one node's entry with another node's blob.
 */
async function stagePages(username: string, pages: readonly FileNodeTreePage[]): Promise<void> {
  const nodes = pages.flatMap((page) => page.nodes);
  const staged = await stageNodes(username, nodes);
  const rows = staged.filter((row) => row.parentId !== null && !isHiddenTreePath(row.path));
  const mapped = await prepassTable(username).bulkGet(rows.map((row) => row.nodeId));
  const held = await driveEntriesTable(accountDb(username)).bulkGet(
    rows.map((row) => normalizeDriveEntryPath(row.path)),
  );
  const visible = rows.flatMap((row, index) => {
    const holder = held[index]?.nodeId;
    if (mapped[index] ? holder !== row.nodeId : holder && holder !== row.nodeId) return [];
    return [{ entry: parseEntry(row.data) }];
  });
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
async function writeResolvedTree(
  username: string,
): Promise<{ blocked: boolean; keptUnsavedPaths: string[] }> {
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

  const occupants = await occupantsOfFinalPaths(username, finals);
  if (occupants.unsaved.length > 0) {
    await rememberKeptUnsavedDocuments(username, occupants.unsaved);
    return { blocked: true, keptUnsavedPaths: occupants.unsaved };
  }
  // The node landing on a replaced occupant's path never keeps that file's
  // offline copy: its local document goes now (outside the transaction), its
  // blob and Drive pin with the sidecar moves, its page setup after them.
  for (const path of occupants.replaced) await retainOrDropLocalDocument(username, path);

  await writeMeta(username, DRIVE_TREE_ROOTS_KEY, JSON.stringify(roots));
  // Rows, blobs and pins commit together with the end of the pre-pass map: a
  // pass stopped before the commit replays from the same map and unmoved
  // sidecars; one stopped after it takes a fresh map from the placed rows, so
  // no blob ever moves twice.
  const moves = await inDriveTreeTransaction(username, async () => {
    for (const path of occupants.replaced) {
      await removeDriveContentBlob(username, path);
      await removeDriveAvailability(username, path);
    }
    const moved = await moveSidecarsOfMovedNodes(username, finals);
    await upsertDriveEntriesInBulk(username, finals);
    await clearPrepass(username);
    return moved;
  }, ["drive_tree_prepass", "meta"]);
  // Page setups (localStorage) follow once, from the same final map.
  removeDocsPageSetupOverrides(occupants.replaced.map((path) => `/${path}`));
  moveDocsPageSetupOverrides(moves.map(({ from, to }) => ({ from: `/${from}`, to: `/${to}` })));
  const keep = new Set(finals.map(({ entry }) => normalizeDriveEntryPath(entry.path)));
  const pruned = await pruneDriveEntriesToKeepSet(username, keep);
  await stampDocsAvailabilityNodeIds(
    username,
    finals.map(({ entry }) => ({ path: entry.path, nodeId: entry.nodeId })),
  );
  return { blocked: false, keptUnsavedPaths: pruned.keptUnsavedPaths };
}

/**
 * Final paths whose current row belongs to another node that the pass does not
 * move to a different final path. `unsaved`: that row has unsaved collab work,
 * so the pass blocks. `replaced`: the rest, whose blob and pins must not stay
 * for the node landing there. A node that is in `finals` elsewhere is moving
 * away; a same-node refresh is fine. Only reads.
 */
async function occupantsOfFinalPaths(
  username: string,
  finals: readonly { entry: WgwDriveDirectoryEntry }[],
): Promise<{ unsaved: string[]; replaced: string[] }> {
  const targets = new Map<string, string>();
  for (const { entry } of finals) {
    if (entry.nodeId) targets.set(entry.nodeId, normalizeDriveEntryPath(entry.path));
  }
  const paths = finals.map(({ entry }) => normalizeDriveEntryPath(entry.path));
  const rows = await driveEntriesTable(accountDb(username)).bulkGet(paths);
  const unsaved: string[] = [];
  const replaced: string[] = [];
  for (const [index, row] of rows.entries()) {
    const occupant = row?.nodeId;
    const nodeId = finals[index]!.entry.nodeId;
    if (!row || !occupant || !nodeId || occupant === nodeId) continue;
    const movesTo = targets.get(occupant);
    if (movesTo !== undefined && movesTo !== paths[index]) continue;
    if (await documentHasUnsavedLocalWork(row.id)) unsaved.push(row.id);
    else replaced.push(row.id);
  }
  return { unsaved, replaced };
}

/**
 * A node that had a row at another path takes that path's blob and
 * availability (Drive and Docs) with it, per node, so a nested rename never
 * leaves a blob on the outer path. Sources are the node's pre-pass paths that
 * no other node's row holds now, then the paths its rows hold now. Pages never
 * put a node on a path another node holds (`skipOtherNodes`), so another
 * node's row there means a local rename moved that row and its blob in since:
 * the blob there is not this node's. A local move of this node's own row is
 * followed through its current path. Two phases: a node renamed onto a path
 * another node is leaving never overwrites that node's blob. Runs inside the
 * write transaction, before any final row is written. Returns the moves, for
 * the page setups.
 */
async function moveSidecarsOfMovedNodes(
  username: string,
  finals: readonly { entry: WgwDriveDirectoryEntry }[],
): Promise<Array<{ from: string; to: string }>> {
  const table = driveEntriesTable(accountDb(username));
  const holder = new Map<string, string>();
  const current = new Map<string, string[]>();
  for (const row of await table.where("nodeId").above("").toArray()) {
    holder.set(row.id, row.nodeId!);
    current.set(row.nodeId!, [...(current.get(row.nodeId!) ?? []), row.id]);
  }
  const previous = new Map(
    (await prepassTable(username).toArray()).map((row) => [row.nodeId, row.paths]),
  );
  const moves = new SidecarMoves();
  for (const { entry } of finals) {
    const nodeId = entry.nodeId;
    if (!nodeId) continue;
    const target = normalizeDriveEntryPath(entry.path);
    for (const from of previous.get(nodeId) ?? []) {
      const now = holder.get(from);
      if (!now || now === nodeId) moves.add(from, target);
    }
    for (const from of current.get(nodeId) ?? []) moves.add(from, target);
  }
  return moves.apply(username);
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

function prepassTable(username: string) {
  return driveTreePrepassTable(accountDb(username));
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
