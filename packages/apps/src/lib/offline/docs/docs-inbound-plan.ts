import type { PendingWrite } from "@/lib/offline/core/inbound-sync";

/**
 * Pure half of Docs inbound (#1563): the FileNode outcomes Drive inbound
 * reports, and which paths a queued write still owns. Docs home lists the
 * Drive tree since #2063 C4, so no Docs view cache is planned here.
 */

/** What a queued file write owns: the row at its path, or only the star. */
export type DocsPendingField = "location" | "starred";
export type DocsPendingWrites = ReadonlyMap<string, PendingWrite<DocsPendingField>>;

/** The FileNode facts of one outcome. `modifiedAt` is in seconds. */
export type DocsNodeFacts = { directory: boolean; size: number; modifiedAt: number };

/**
 * One FileNode outcome from Drive inbound, by path:
 * - `removed`: destroyed elsewhere and dropped locally (no unsaved text kept).
 * - `moved`: renamed or moved, one change per relocated file, from its path
 *   before the batch to its final path. Exact paths only: a folder `moved`
 *   does not carry the stars or local text of the paths under it (#2063 C7).
 * - `upserted`: created or changed in place.
 */
export type DocsInboundChange =
  | { kind: "removed"; path: string }
  | { kind: "moved"; from: string; to: string; node: DocsNodeFacts }
  | { kind: "upserted"; path: string; node: DocsNodeFacts };

/** A path's key: no leading or trailing slash. */
export function docsSourceKey(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

/** A queued create or rename target owns the row at this path. */
export function docsRowOwnedByQueuedWrite(pending: DocsPendingWrites, key: string): boolean {
  const write = pending.get(key);
  return Boolean(write && !write.deleting && write.fields.has("location"));
}

/** A queued trash or rename moves the Doc away from this path. */
export function docsRowHiddenByQueuedWrite(pending: DocsPendingWrites, key: string): boolean {
  return pending.get(key)?.deleting === true;
}
