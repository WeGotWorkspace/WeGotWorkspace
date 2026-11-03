import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import {
  listRemovedIds,
  readPendingWrites,
  type PendingRowView,
} from "@/lib/offline/core/inbound-sync";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  docsRowHiddenByQueuedWrite,
  docsRowOwnedByQueuedWrite,
  docsSourceKey,
  planDocsListingInbound,
  type DocsInboundChange,
  type DocsPendingField,
  type DocsPendingWrites,
} from "@/lib/offline/docs/docs-inbound-plan";
import type { DocsListingBrowseFilters } from "@/lib/offline/docs/docs-listing-cache-key";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import { moveDocsPath } from "@/lib/offline/docs/docs-path-moves";
import { DOCS_DOMAIN, docsListingRowsTable } from "@/lib/offline/docs/docs-schema";
import { readDocsStarredPaths, writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import {
  docsListingRows,
  readDocsListingFromCache,
} from "@/lib/offline/docs-listing-offline-store";
import { nextPathAfterRename } from "@/lib/offline/shared/drive-sidecar-mutations";
import { documentHasUnsavedLocalWork } from "@/lib/offline/drive/drive-local-document";

export type { DocsInboundChange, DocsNodeFacts } from "@/lib/offline/docs/docs-inbound-plan";

/**
 * Docs inbound reconciliation (#1563) on the shared inbound engine (#1565).
 * Drive's FileNode inbound reports what happened to each node; this applies
 * it to every cached Docs view and tells every open tab to re-read.
 */

const topic = cacheChangedTopic(DOCS_DOMAIN);

/** Every tab re-reads its Docs home view; this one included. */
export const notifyDocsCachesChanged = topic.notifyAllTabs;

/** Hear a Docs cache change for `username` from any tab, this one included. */
export const subscribeDocsCachesChanged = topic.subscribe;

function parsePayload(row: OfflineOutboxRow): DocsOutboxPayload | null {
  try {
    return JSON.parse(row.payload) as DocsOutboxPayload;
  } catch {
    return null;
  }
}

/** The paths one queued Docs write touches, as the engine reads them. */
function docsPendingRowViews(row: OfflineOutboxRow): PendingRowView<DocsPendingField>[] {
  const payload = parsePayload(row);
  switch (payload?.op) {
    case "create":
      return [{ id: docsSourceKey(payload.apiPath), fields: ["location"] }];
    case "rename": {
      const to = nextPathAfterRename(payload.from, payload.destination, payload.to);
      return [
        { id: docsSourceKey(payload.from), deleting: true },
        { id: docsSourceKey(to), fields: ["location"] },
      ];
    }
    case "trash":
      return [{ id: docsSourceKey(payload.from), deleting: true }];
    case "star":
      return [{ id: docsSourceKey(payload.path), fields: ["starred"] }];
    default:
      return [];
  }
}

/** Queued Docs writes by listing path, through the shared engine. */
export async function readDocsPendingWrites(username: string): Promise<DocsPendingWrites> {
  const rows = await listOutboxMutationsForDomain(username, DOCS_DOMAIN);
  return readPendingWrites(rows, docsPendingRowViews);
}

async function applyStarredPathChanges(
  username: string,
  changes: readonly DocsInboundChange[],
): Promise<boolean> {
  const before = await readDocsStarredPaths(username);
  if (before.length === 0) return false;
  let paths = before;
  for (const change of changes) {
    if (change.kind === "removed") {
      const key = docsSourceKey(change.path);
      paths = paths.filter((path) => docsSourceKey(path) !== key);
    } else if (change.kind === "moved") {
      const from = docsSourceKey(change.from);
      const to = docsSourceKey(change.to);
      paths = paths.map((path) => {
        const key = docsSourceKey(path);
        if (key !== from && !key.startsWith(`${from}/`)) return path;
        return `/${to}${key.slice(from.length)}`;
      });
    }
  }
  if (paths.length === before.length && paths.every((path, at) => path === before[at])) {
    return false;
  }
  await writeDocsStarredPaths(username, paths);
  return true;
}

/**
 * Apply Drive's FileNode outcomes to every cached Docs home view and to the
 * cached starred paths, then tell every tab. Rows a queued write still owns
 * are left alone. Returns whether a Docs cache changed.
 */
export async function applyDocsInboundChanges(
  username: string,
  changes: readonly DocsInboundChange[],
): Promise<boolean> {
  if (!username || changes.length === 0) return false;
  // Read before the transaction: an outside await would commit it early.
  const pending = await readDocsPendingWrites(username);
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = docsListingRowsTable(db);
  const listingChanged = await db.transaction("rw", table, async () => {
    const views = planDocsListingInbound(await table.toArray(), changes, pending);
    for (const [cacheKey, results] of views) {
      await table.where("cacheKey").equals(cacheKey).delete();
      await table.bulkPut(docsListingRows(cacheKey, results));
    }
    return views.size > 0;
  });
  const starsChanged = await applyStarredPathChanges(username, changes);
  const changed = listingChanged || starsChanged;
  if (changed) notifyDocsCachesChanged(username);
  await followRemoteMoves(username, changes, pending);
  return changed;
}

/**
 * An editor that has a Doc open at a path that moved elsewhere follows it, and
 * its local text moves along, so unsaved text is saved to the file, not to a
 * new file at the old path. A path a queued local write owns keeps the local
 * name (decision 5).
 */
async function followRemoteMoves(
  username: string,
  changes: readonly DocsInboundChange[],
  pending: DocsPendingWrites,
): Promise<void> {
  for (const change of changes) {
    if (change.kind !== "moved") continue;
    const from = docsSourceKey(change.from);
    if (docsRowOwnedByQueuedWrite(pending, from) || docsRowHiddenByQueuedWrite(pending, from)) {
      continue;
    }
    await moveDocsPath(username, from, change.to);
  }
}

/**
 * Whether `next` lists other rows than the view's cache holds. A live listing
 * that rewrites the cache this way tells the other tabs, as the inbound does.
 */
export async function docsListingRowsDiffer(
  username: string,
  filters: DocsListingBrowseFilters,
  next: readonly WgwUnifiedSearchResult[],
): Promise<boolean> {
  const cached = (await readDocsListingFromCache(username, filters))?.results ?? [];
  const keys = new Set(cached.map((row) => row.sourceKey));
  return keys.size !== next.length || next.some((row) => !keys.has(row.sourceKey));
}

/**
 * Merge a view's full live listing with its cached rows instead of replacing
 * them. A cached row the server no longer lists goes, unless a queued write
 * owns it or it has unsaved collab text; a live row a queued trash or rename
 * moved away from stays hidden.
 */
export async function mergeLiveDocsListing(
  username: string,
  filters: DocsListingBrowseFilters,
  live: readonly WgwUnifiedSearchResult[],
): Promise<WgwUnifiedSearchResult[]> {
  const pending = await readDocsPendingWrites(username);
  const visible = live.filter((row) => !docsRowHiddenByQueuedWrite(pending, row.sourceKey));
  const cached = (await readDocsListingFromCache(username, filters))?.results ?? [];
  const listed = new Set(live.map((row) => row.sourceKey));
  const items = cached.map((row) => ({ id: row.sourceKey, row }));
  const removed = new Set(
    listRemovedIds(items, listed, (item) => docsRowOwnedByQueuedWrite(pending, item.id)),
  );
  const kept: WgwUnifiedSearchResult[] = [];
  for (const { id, row } of items) {
    if (listed.has(id)) continue;
    if (!removed.has(id) || (await documentHasUnsavedLocalWork(id))) kept.push(row);
  }
  // Callers sort for display and for the cache.
  return [...visible, ...kept];
}
