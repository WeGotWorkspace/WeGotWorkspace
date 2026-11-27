import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import { withCrossTabLock } from "@/lib/offline/core/cross-tab-lock";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import type { OutboxFlushContext } from "@/lib/offline/core/outbox-flush";
import { getOutboxMutation, settleSentOutboxMutation } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  readDriveEntryFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { driveUploadItemsTable } from "@/lib/offline/drive/upload/drive-upload-schema";
import { hasTagDelta, mergeTagDeltas, type TagDelta } from "@/lib/tags/tag-delta";
import { normalizeTag } from "@/lib/tags/tag-rules";

/** A tag edit waiting in the Drive or Docs outbox (#2402): one row per path, merged. */
export type DriveTagsOutboxPayload = { op: "tags"; path: string } & TagDelta;

/** The tags after a delta: removes first, then adds, each normalised and without repeats. */
export function tagsAfterDelta(tags: readonly string[], delta: TagDelta): string[] {
  const removed = new Set((delta.tagsRemove ?? []).map(normalizeTag));
  const next = tags.filter((tag) => !removed.has(normalizeTag(tag)));
  for (const tag of delta.tagsAdd ?? []) {
    const normalized = normalizeTag(tag);
    if (normalized && !next.some((current) => normalizeTag(current) === normalized)) {
      next.push(normalized);
    }
  }
  return next;
}

/** The domains whose outbox can hold a tag row: Drive and Docs share the one tree. */
const TAG_DOMAINS: readonly string[] = [DRIVE_DOMAIN, DOCS_DOMAIN];

function queuedTagsPath(row: OfflineOutboxRow): string | null {
  if (row.op !== "tags" || !TAG_DOMAINS.includes(row.domain)) return null;
  try {
    return (JSON.parse(row.payload) as DriveTagsOutboxPayload).path;
  } catch {
    return null;
  }
}

/**
 * Applies the delta to the cached row and queues it, in one transaction: a flush
 * settling the row (`settleSentOutboxMutation`) sees the merged delta or the old one,
 * never a lost write, and two tabs cannot overwrite each other's merge. One row is
 * kept per path and moves to the app of the latest edit, so a later remove is never
 * undone by an older add, and the app the user is in sends it.
 */
async function applyAndQueueTags(
  username: string,
  domain: string,
  path: string,
  delta: TagDelta,
): Promise<string[] | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return db.transaction(
    "rw",
    [driveEntriesTable(db), driveUploadItemsTable(db), db.outbox],
    async () => {
      const entry = await readDriveEntryFromCache(username, path);
      let tags: string[] | null = null;
      if (entry) {
        tags = tagsAfterDelta(entry.tags ?? [], delta);
        const { tags: _previous, ...rest } = entry;
        await upsertDriveEntry(username, tags.length > 0 ? { ...rest, tags } : rest);
      }
      const queued = (await db.outbox.toArray()).find((row) => queuedTagsPath(row) === path);
      if (!queued) {
        const newest = await db.outbox.orderBy("createdAt").last();
        await db.outbox.put({
          id: crypto.randomUUID(),
          domain,
          op: "tags",
          payload: JSON.stringify({ op: "tags", path, ...delta }),
          createdAt: Math.max(Date.now(), (newest?.createdAt ?? 0) + 1),
          retries: 0,
        });
        return tags;
      }
      const merged = mergeTagDeltas(JSON.parse(queued.payload) as TagDelta, delta);
      // The app the user edited in last owns the row: only its flush sends it.
      await db.outbox.put({
        ...queued,
        domain,
        payload: JSON.stringify({ op: "tags", path, ...merged }),
        retries: 0,
      });
      return tags;
    },
  );
}

/**
 * Sends a queued tag row for the Drive or Docs flush. Both apps send under one lock:
 * the row moves to the app of the latest edit while the other may still be sending
 * it, and two requests in flight could land out of order. The row is read again
 * inside the lock; one that is gone or has moved to the other app is left alone.
 */
export function sendQueuedTagsRow(
  username: string,
  domain: string,
  row: OfflineOutboxRow,
  setTags: NonNullable<DriveAPIOperations["setTags"]>,
  context: OutboxFlushContext,
): Promise<"handled"> {
  return withCrossTabLock<"handled">(`wgw-outbox-tags:${username}`, async () => {
    const current = await getOutboxMutation(username, row.id);
    if (!current || current.domain !== domain) return "handled";
    const payload = JSON.parse(current.payload) as DriveTagsOutboxPayload;
    await setTags({ path: payload.path, tagsAdd: payload.tagsAdd, tagsRemove: payload.tagsRemove });
    // A delta merged in while this was sent stays queued and is sent again.
    const settlement = await settleSentOutboxMutation(username, current);
    // A row that moved to the other app is sent by it: here it would parse as null and be dropped.
    if (settlement.kind !== "changed" || settlement.row.domain === domain) {
      context.resend(settlement);
    }
    return "handled";
  });
}

async function hasQueuedTags(username: string, path: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return (await db.outbox.toArray()).some((row) => queuedTagsPath(row) === path);
}

/**
 * `setTags` for a signed-in account with the offline layer. Online it asks the server
 * and stores the tags the server answers. Offline it applies the delta to the cached
 * row at once and queues it, merged with any edit already waiting for that path.
 */
export function createHybridSetTags(
  username: string,
  live: DriveAPIOperations,
  domain: string,
  notify: () => void,
  /** Sends the queued edit now: the browser may be online, so no reconnect will. */
  flushAfterQueue: () => void,
): NonNullable<DriveAPIOperations["setTags"]> {
  return async (input, opts) => {
    const path = normalizeApiVirtualPath(input.path);
    const delta: TagDelta = {
      ...(input.tagsAdd?.length ? { tagsAdd: input.tagsAdd } : {}),
      ...(input.tagsRemove?.length ? { tagsRemove: input.tagsRemove } : {}),
    };
    if (!hasTagDelta(delta)) {
      return (await readDriveEntryFromCache(username, path))?.tags ?? [];
    }
    // A queued edit for the path is merged, not raced: the flush would send it after this one.
    if (readBrowserOnline() && live.setTags && !(await hasQueuedTags(username, path))) {
      try {
        const tags = await live.setTags({ path, ...delta }, opts);
        const entry = await readDriveEntryFromCache(username, path);
        if (entry) {
          const { tags: _previous, ...rest } = entry;
          await upsertDriveEntry(username, tags.length > 0 ? { ...rest, tags } : rest);
        }
        notify();
        return tags;
      } catch (error) {
        if (opts?.signal?.aborted || !isFetchNetworkError(error)) throw error;
      }
    }
    const tags = await applyAndQueueTags(username, domain, path, delta);
    notify();
    if (readBrowserOnline()) flushAfterQueue();
    return tags ?? [];
  };
}
