import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  enqueueOutboxMutation,
  listOutboxMutationsForDomain,
  putOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import {
  readDriveEntryFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { mergeTagDeltas, tagsAfterDelta, type TagDelta } from "@/lib/tags/tag-delta";

/** A tag edit waiting in the Drive or Docs outbox (#2402): one row per path, merged. */
export type DriveTagsOutboxPayload = { op: "tags"; path: string } & TagDelta;

/** Writes the tags of a cached tree row, if the row is cached. Returns the tags written. */
async function writeCachedEntryTags(
  username: string,
  path: string,
  next: (current: readonly string[]) => string[],
): Promise<string[] | null> {
  const entry = await readDriveEntryFromCache(username, path);
  if (!entry) return null;
  const tags = next(entry.tags ?? []);
  const { tags: _previous, ...rest } = entry;
  await upsertDriveEntry(username, tags.length > 0 ? { ...rest, tags } : rest);
  return tags;
}

async function queueTagsMutation(
  username: string,
  domain: string,
  payload: DriveTagsOutboxPayload,
): Promise<void> {
  const queued = (await listOutboxMutationsForDomain(username, domain)).find((row) => {
    if (row.op !== "tags") return false;
    try {
      return (JSON.parse(row.payload) as DriveTagsOutboxPayload).path === payload.path;
    } catch {
      return false;
    }
  });
  if (!queued) {
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain,
      op: "tags",
      payload: JSON.stringify(payload),
    });
    return;
  }
  const merged = mergeTagDeltas(JSON.parse(queued.payload) as TagDelta, payload);
  await putOutboxMutation(username, {
    ...queued,
    payload: JSON.stringify({ op: "tags", path: payload.path, ...merged }),
    retries: 0,
  });
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
): NonNullable<DriveAPIOperations["setTags"]> {
  return async (input, opts) => {
    const path = normalizeApiVirtualPath(input.path);
    const delta: TagDelta = {
      ...(input.tagsAdd?.length ? { tagsAdd: input.tagsAdd } : {}),
      ...(input.tagsRemove?.length ? { tagsRemove: input.tagsRemove } : {}),
    };
    if (readBrowserOnline() && live.setTags) {
      try {
        const tags = await live.setTags({ path, ...delta }, opts);
        await writeCachedEntryTags(username, path, () => tags);
        notify();
        return tags;
      } catch (error) {
        if (opts?.signal?.aborted || !isFetchNetworkError(error)) throw error;
      }
    }
    const tags = await writeCachedEntryTags(username, path, (current) =>
      tagsAfterDelta(current, delta),
    );
    await queueTagsMutation(username, domain, { op: "tags", path, ...delta });
    notify();
    return tags ?? [];
  };
}
