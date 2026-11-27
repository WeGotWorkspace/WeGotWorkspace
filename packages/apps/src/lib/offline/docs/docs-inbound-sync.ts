import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { readPendingWrites, type PendingRowView } from "@/lib/offline/core/inbound-sync";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  docsRowHiddenByQueuedWrite,
  docsRowOwnedByQueuedWrite,
  docsSourceKey,
  type DocsInboundChange,
  type DocsPendingField,
  type DocsPendingWrites,
} from "@/lib/offline/docs/docs-inbound-plan";
import {
  listQueuedFileWriteRows,
  parseFileOutboxPayload,
  type DocsOutboxPayload,
} from "@/lib/offline/docs/docs-outbox-flush";
import { docsPathAfterMove, moveDocsPaths } from "@/lib/offline/docs/docs-path-moves";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { readDocsStarredPaths, writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import { nextPathAfterRename } from "@/lib/offline/shared/drive-sidecar-mutations";

export type { DocsInboundChange, DocsNodeFacts } from "@/lib/offline/docs/docs-inbound-plan";

/**
 * Docs inbound reconciliation (#1563) on the shared inbound engine (#1565).
 * Drive's FileNode inbound reports what happened to each node. Docs home
 * lists the Drive tree (#2063 C4), so what is left for Docs is the starred
 * paths and an open editor that follows its file.
 */

const topic = cacheChangedTopic(DOCS_DOMAIN);

/** Every tab re-reads its Docs home view; this one included. */
export const notifyDocsCachesChanged = topic.notifyAllTabs;

/** Hear a Docs cache change for `username` from any tab, this one included. */
export const subscribeDocsCachesChanged = topic.subscribe;

/** The paths one queued file write touches, as the engine reads them. */
function docsPendingRowViews(row: OfflineOutboxRow): PendingRowView<DocsPendingField>[] {
  const payload = parseFileOutboxPayload(row);
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

/**
 * Where `path` lives once the queued renames and moves land, in queue order,
 * or null when none moves it (#1563). Trash is left out: an open Doc that is
 * trashed stays at its path and the editor's own "gone" flow takes over.
 */
export function docsPathAfterQueuedRenames(
  payloads: readonly (DocsOutboxPayload | null)[],
  path: string,
): string | null {
  let current = docsSourceKey(path);
  let moved = false;
  for (const payload of payloads) {
    if (payload?.op !== "rename") continue;
    const to = nextPathAfterRename(payload.from, payload.destination, payload.to);
    const next = docsPathAfterMove(current, payload.from, to);
    if (next === null || next === current) continue;
    current = next;
    moved = true;
  }
  return moved ? `/${current}` : null;
}

/** {@link docsPathAfterQueuedRenames} for this account's queued file writes. */
export async function readDocsQueuedRenameTarget(
  username: string,
  path: string,
): Promise<string | null> {
  const rows = await listQueuedFileWriteRows(username);
  return docsPathAfterQueuedRenames(rows.map(parseFileOutboxPayload), path);
}

/** Queued file writes (Docs and Drive outbox) by path, through the shared engine. */
export async function readDocsPendingWrites(username: string): Promise<DocsPendingWrites> {
  return readPendingWrites(await listQueuedFileWriteRows(username), docsPendingRowViews);
}

/**
 * Starred paths follow the sync's final map (#2063 C7): each star is read
 * once, from its path before the sync, and written only at its own Doc's final
 * path. Exact paths only (the batch lists every relocated file). A star whose
 * Doc was removed, or that sat on a path another Doc landed on, goes, so a
 * swap keeps each Doc's own star and a Doc never inherits a previous file's.
 */
async function applyStarredPathChanges(
  username: string,
  changes: readonly DocsInboundChange[],
): Promise<boolean> {
  const before = await readDocsStarredPaths(username);
  if (before.length === 0) return false;
  const finalOf = new Map<string, string>();
  const gone = new Set<string>();
  for (const change of changes) {
    if (change.kind === "moved") {
      finalOf.set(docsSourceKey(change.from), docsSourceKey(change.to));
    } else if (change.kind === "removed") {
      gone.add(docsSourceKey(change.path));
    }
  }
  const landed = new Set(finalOf.values());
  const paths: string[] = [];
  for (const path of before) {
    const key = docsSourceKey(path);
    const to = finalOf.get(key);
    if (to !== undefined) paths.push(`/${to}`);
    else if (!gone.has(key) && !landed.has(key)) paths.push(path);
  }
  const after = [...new Set(paths)];
  if (after.length === before.length && after.every((path, at) => path === before[at])) {
    return false;
  }
  await writeDocsStarredPaths(username, after);
  return true;
}

/**
 * Apply Drive's FileNode outcomes to the cached starred paths, then tell every
 * tab, and let an open editor follow a moved file. Returns whether the stars
 * changed.
 */
export async function applyDocsInboundChanges(
  username: string,
  changes: readonly DocsInboundChange[],
): Promise<boolean> {
  if (!username || changes.length === 0) return false;
  const pending = await readDocsPendingWrites(username);
  const changed = await applyStarredPathChanges(username, changes);
  if (changed) notifyDocsCachesChanged(username);
  await followRemoteMoves(username, changes, pending);
  return changed;
}

/**
 * An editor that has a Doc open at a path that moved elsewhere follows it, and
 * its local text moves along, so unsaved text is saved to the file, not to a
 * new file at the old path. A path a queued local write owns keeps the local
 * name (decision 5). A swap moves each editor once, to its own Doc.
 */
async function followRemoteMoves(
  username: string,
  changes: readonly DocsInboundChange[],
  pending: DocsPendingWrites,
): Promise<void> {
  const moves: { from: string; to: string }[] = [];
  for (const change of changes) {
    if (change.kind !== "moved") continue;
    const from = docsSourceKey(change.from);
    if (docsRowOwnedByQueuedWrite(pending, from) || docsRowHiddenByQueuedWrite(pending, from)) {
      continue;
    }
    moves.push({ from, to: change.to });
  }
  // The changes are the sync's final map (one move per relocated file, read
  // against the paths before it): moved together, and heard once.
  await moveDocsPaths(username, moves);
}
