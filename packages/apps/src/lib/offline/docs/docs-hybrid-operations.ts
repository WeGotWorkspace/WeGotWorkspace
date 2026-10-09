import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  resolveFreeName,
} from "@/drive-core/src/drive-batch-utils";
import { parentAndName } from "@/lib/files/api-path";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { isDriveTrashApiPath, normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import {
  migrateDocsAvailabilityPath,
  normalizeDocsAvailabilityPath,
  readDocsAvailability,
  removeDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { DOCS_DOMAIN, type OfflineDocsAvailabilityRow } from "@/lib/offline/docs/docs-schema";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import {
  flushDocsOutbox,
  removeOutboxMutationsForDocsPath,
  type OutboxFlushResult,
} from "@/lib/offline/docs/docs-outbox-flush";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import {
  buildOfflineDocsSearchResult,
  docsHomeBrowseFiltersForApiPath,
  readDocsListingFromCache,
  restoreDocsListingResult,
  removeDocsListingResult,
  renameDocsListingResult,
} from "@/lib/offline/docs-listing-offline-store";
import { readOfflineDocsUsername } from "@/lib/offline/offline-session";
import {
  downloadOfflineDocsFile,
  readOfflineDocsFileBlob,
} from "@/lib/offline/docs/docs-offline-download";
import {
  applyDocsStarToggle,
  readDocsStarredPaths,
  writeDocsStarredPaths,
} from "@/lib/offline/docs/docs-stars-store";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import {
  captureDocsCollabOfflinePersistence,
  clearDocsCollabOfflinePersistence,
  migrateCollabPersistence,
  restoreDocsCollabOfflinePersistence,
  type DocsCollabOfflinePersistenceSnapshot,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

function rethrowUnlessOfflineQueue(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>();

async function flushDocsOutboxTask(username: string): Promise<OutboxFlushResult> {
  const result = await flushDocsOutbox(username);
  reportDocsSyncConflicts(result.stateMismatches);
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () => flushDocsOutboxTask(username));
}

export function getDocsSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}

async function queueDocsOutbox(username: string, payload: DocsOutboxPayload): Promise<void> {
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: DOCS_DOMAIN,
    op: payload.op,
    payload: JSON.stringify(payload),
  });
}

async function applyOfflineTrashSideEffects(username: string, from: string): Promise<void> {
  const apiPath = normalizeApiVirtualPath(from);
  const room = normalizeDocsAvailabilityPath(apiPath);
  await removeOutboxMutationsForDocsPath(username, apiPath);
  await removeDocsListingResult(username, apiPath);
  await clearDocsCollabOfflinePersistence(room);
  await removeDocsAvailability(username, room);
}

/** Best-effort local cleanup after server trash; must not fail the user action. */
async function applyOfflineTrashSideEffectsSafely(username: string, from: string): Promise<void> {
  try {
    await applyOfflineTrashSideEffects(username, from);
  } catch (error) {
    console.warn("[docs-hybrid] local trash cleanup failed", error);
  }
}

export type DocsTrashUndoSnapshot = {
  apiPath: string;
  listingResult: WgwUnifiedSearchResult;
  availability?: OfflineDocsAvailabilityRow;
  collabPersistence?: DocsCollabOfflinePersistenceSnapshot;
};

/** Capture listing + availability state before an offline trash (for undo). */
export async function captureOfflineDocsTrashSnapshot(
  username: string,
  apiPath: string,
): Promise<DocsTrashUndoSnapshot> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const sourceKey = normalized.replace(/^\/+/, "");
  let listingResult: WgwUnifiedSearchResult | undefined;
  for (const filters of docsHomeBrowseFiltersForApiPath(normalized)) {
    const cached = await readDocsListingFromCache(username, filters);
    listingResult = cached?.results.find((row) => row.sourceKey === sourceKey);
    if (listingResult) break;
  }
  const availability = await readDocsAvailability(username, normalized);
  const collabPersistence = await captureDocsCollabOfflinePersistence(normalized);
  return {
    apiPath: normalized,
    listingResult: listingResult ?? buildOfflineDocsSearchResult(normalized),
    availability,
    collabPersistence,
  };
}

/** Reverse a queued offline trash: drop outbox entry and restore local caches. */
export async function undoOfflineDocsTrash(
  username: string,
  snapshot: DocsTrashUndoSnapshot,
): Promise<void> {
  await removeOutboxMutationsForDocsPath(username, snapshot.apiPath);
  await restoreDocsListingResult(username, snapshot.listingResult);
  if (snapshot.availability) {
    await writeDocsAvailability(username, snapshot.availability);
  }
  if (snapshot.collabPersistence) {
    await restoreDocsCollabOfflinePersistence(snapshot.apiPath, snapshot.collabPersistence);
  }
}

async function applyOfflineRenameSideEffects(
  username: string,
  from: string,
  destination: string,
  to: string,
): Promise<void> {
  const newApiPath = docsOutboxPathFromRename(from, destination, to);
  await renameDocsListingResult(username, from, newApiPath);
  await applyOnlineRenameSideEffects(username, from, destination, to);
}

async function applyOnlineRenameSideEffects(
  username: string,
  from: string,
  destination: string,
  to: string,
): Promise<void> {
  const oldPath = normalizeDocsAvailabilityPath(from);
  const normalizedDest = normalizeApiVirtualPath(destination);
  const newPath = normalizeDocsAvailabilityPath(
    normalizedDest === "/" ? `/${to}` : `${normalizedDest}/${to}`,
  );
  if (isDocsCollabEditablePath(oldPath) && isDocsCollabEditablePath(newPath)) {
    try {
      await migrateCollabPersistence(oldPath, newPath);
    } catch (error) {
      console.warn("[docs-hybrid] collab persistence migration failed", error);
    }
  }
  await migrateDocsAvailabilityPath(username, oldPath, newPath);
}

export function createHybridDocsDriveOperations(username: string): DriveAPIOperations {
  const live = createWgwDriveOperations("/");

  return {
    ...live,
    renameItem: async (input, opts) => {
      const destination = normalizeApiVirtualPath(input.destination);
      const isTrash = isDriveTrashApiPath(destination, username);
      if (readBrowserOnline()) {
        try {
          if (isTrash) {
            await ensureTrashFolder(live, username, new Set(), opts?.signal);
          }
          let to = input.to;
          if (isTrash) {
            const trashNames = await listTrashEntryNames(live, destination, opts?.signal);
            to = resolveFreeName(input.to, trashNames);
          }
          const data = await live.renameItem(
            { ...input, to },
            {
              ...opts,
              refreshState: isTrash ? false : opts?.refreshState,
            },
          );
          if (isTrash) {
            await applyOfflineTrashSideEffectsSafely(username, input.from);
          } else {
            await applyOnlineRenameSideEffects(username, input.from, input.destination, input.to);
          }
          return data;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      const from = normalizeApiVirtualPath(input.from);
      let to = input.to;
      if (isTrash) {
        const trashNames = await listTrashEntryNames(live, destination, opts?.signal);
        to = resolveFreeName(input.to, trashNames);
        await applyOfflineTrashSideEffects(username, from);
      } else {
        await applyOfflineRenameSideEffects(username, from, destination, input.to);
      }
      const payload: DocsOutboxPayload = isTrash
        ? { op: "trash", from, destination, to }
        : { op: "rename", from, destination, to: input.to };
      await queueDocsOutbox(username, payload);
      return offlineQueuedDriveData(destination);
    },
    uploadFiles: async (input, opts) => {
      if (readBrowserOnline()) {
        try {
          return await live.uploadFiles(input, opts);
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      for (const file of input.files) {
        const apiPath = normalizeApiVirtualPath(
          input.cwd === "/" ? `/${file.name}` : `${input.cwd}/${file.name}`,
        );
        const content = await file.text();
        await queueDocsOutbox(username, { op: "create", apiPath, content });
      }
      return offlineQueuedDriveData(normalizeApiVirtualPath(input.cwd));
    },
    downloadFile: async (path, opts) => {
      const normalized = normalizeApiVirtualPath(path);
      if (readBrowserOnline()) {
        try {
          await live.downloadFile(normalized, opts);
          return;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      await downloadOfflineDocsFile(username, normalized);
    },
    readFileBlob: async (path, opts) => {
      const normalized = normalizeApiVirtualPath(path);
      if (readBrowserOnline()) {
        try {
          return await live.readFileBlob(normalized, opts);
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      const blob = await readOfflineDocsFileBlob(username, normalized);
      if (!blob) {
        throw new Error("This file is not available offline.");
      }
      return blob;
    },
    listStars: async (opts) => {
      if (readBrowserOnline()) {
        try {
          const paths = await live.listStars(opts);
          await writeDocsStarredPaths(username, paths);
          return paths;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      return readDocsStarredPaths(username);
    },
    setStar: async (input, opts) => {
      const path = normalizeApiVirtualPath(input.path);
      if (readBrowserOnline()) {
        try {
          await live.setStar({ path, starred: input.starred }, opts);
          await applyDocsStarToggle(username, path, input.starred);
          return;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      await applyDocsStarToggle(username, path, input.starred);
      await queueDocsOutbox(username, { op: "star", path, starred: input.starred });
    },
  };
}

export async function flushDocsOutboxForAccount(
  username?: string | null,
): Promise<OutboxFlushResult | null> {
  const resolved = username ?? readOfflineDocsUsername();
  if (!resolved) return null;
  const result = await runnerFor(resolved).flush();
  return result ?? null;
}

function offlineQueuedDriveData(cwd: string): DriveUIData {
  return {
    user: { username: "", name: "", role: "user", roots: [] },
    cwd,
    directory: { location: cwd, files: [] },
  };
}

export function docsOutboxPathFromRename(from: string, destination: string, to: string): string {
  const normalizedDest = normalizeApiVirtualPath(destination);
  return normalizedDest === "/" ? `/${to}` : `${normalizedDest}/${to}`;
}

export { parentAndName };
