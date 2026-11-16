import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  resolveFreeName,
} from "@/lib/files/drive-entry-names";
import { parentAndName } from "@/lib/files/api-path";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";
import { isDriveTrashApiPath, normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import {
  enqueueOutboxMutation,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import {
  normalizeDocsAvailabilityPath,
  readDocsAvailability,
  removeDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { moveDocsPageSetupOverride } from "@/lib/docs-page-setup";
import {
  applyDriveSidecarPathMigration,
  nextPathAfterRename,
} from "@/lib/offline/shared/drive-sidecar-mutations";
import { onlineOnlyDownloadSelection } from "@/lib/offline/shared/zip-download-online-only";
import { DOCS_DOMAIN, type OfflineDocsAvailabilityRow } from "@/lib/offline/docs/docs-schema";
import type { DocsOutboxPayload } from "@/lib/offline/docs/docs-outbox-flush";
import {
  flushDocsOutbox,
  removeOutboxMutationsForDocsPath,
  type OutboxFlushResult,
} from "@/lib/offline/docs/docs-outbox-flush";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import { notifyDocsCachesChanged } from "@/lib/offline/docs/docs-inbound-sync";
import {
  readDocsOfflineDirectory,
  rememberDocsLiveDirectory,
  readDocsOfflineEntriesByPaths,
} from "@/lib/offline/docs/docs-offline-entries";
import { moveDocsPath } from "@/lib/offline/docs/docs-path-moves";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import {
  buildOfflineDocsSearchResult,
  docsHomeBrowseFiltersForApiPath,
  readDocsListingFromCache,
  restoreDocsListingResult,
  removeDocsListingResult,
  renameDocsListingResult,
} from "@/lib/offline/docs/docs-listing-offline-store";
import { readOfflineDocsUsername } from "@/lib/offline/core/offline-session";
import {
  downloadOfflineDocsFile,
  readOfflineDocsFileBlob,
} from "@/lib/offline/docs/docs-offline-download";
import {
  applyDocsStarToggle,
  readDocsStarredPaths,
  writeDocsStarredPaths,
} from "@/lib/offline/docs/docs-stars-store";
import {
  captureDocsCollabOfflinePersistence,
  clearDocsCollabOfflinePersistence,
  restoreDocsCollabOfflinePersistence,
  type DocsCollabOfflinePersistenceSnapshot,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

function rethrowUnlessOfflineQueue(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>(DOCS_DOMAIN);

async function flushDocsOutboxTask(username: string): Promise<OutboxFlushResult> {
  const result = await flushDocsOutbox(username);
  reportDocsSyncConflicts(result.stateMismatches);
  if (result.flushed > 0) {
    // Open tabs re-read what the flush settled (an editor waiting on a queued create, a list).
    notifyDocsCachesChanged(username);
    // Lists read live (Trash, Starred, Drive) fetch again: the queued writes are on the server
    // now, and this tab's next FileNode pull would take the change without telling them (#1563).
    notifyDriveRemoteChange(username);
  }
  return result;
}

/**
 * The server's stars with this device's queued stars and unstars on top, in
 * queue order (#1563). Another tab that reads the stars online would
 * otherwise drop a star queued offline from the shared cache until it lands.
 */
async function withQueuedStars(username: string, serverPaths: string[]): Promise<string[]> {
  const rows = await listOutboxMutationsForDomain(username, DOCS_DOMAIN);
  const paths = new Set(serverPaths.map((path) => normalizeApiVirtualPath(path)));
  for (const row of rows) {
    let payload: DocsOutboxPayload | null = null;
    try {
      payload = JSON.parse(row.payload) as DocsOutboxPayload;
    } catch {
      continue;
    }
    if (payload?.op !== "star") continue;
    const path = normalizeApiVirtualPath(payload.path);
    if (payload.starred) paths.add(path);
    else paths.delete(path);
  }
  return [...paths];
}

/** Permanent delete is not queued: it cannot be undone, so it waits for a connection. */
export const DOCS_DELETE_NEEDS_CONNECTION = "Deleting permanently needs a connection.";

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
  // The connection may be back already: the write raced the reconnect (whose
  // flush found nothing yet), or a flaky network failed it while the browser
  // said online. No reconnect follows then, so send it now (#2104).
  if (readBrowserOnline()) void runnerFor(username).flushAfterWrite();
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
  await applyDriveSidecarPathMigration(username, from, destination, to);
}

export function createHybridDocsDriveOperations(username: string): DriveAPIOperations {
  const live = createWgwDriveOperations("/");
  // A guest has no write path yet (#1713): writes go to the server and fail
  // there, so nothing is queued that could never land.
  if (wgwIsGuestSession()) return live;

  return {
    ...live,
    downloadSelection: onlineOnlyDownloadSelection(live),
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
            moveDocsPageSetupOverride(input.from, nextPathAfterRename(input.from, destination, to));
          } else {
            await applyOnlineRenameSideEffects(username, input.from, input.destination, input.to);
            await moveDocsPath(
              username,
              input.from,
              docsOutboxPathFromRename(input.from, destination, to),
            );
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
        moveDocsPageSetupOverride(from, nextPathAfterRename(from, destination, to));
        await applyOfflineTrashSideEffects(username, from);
      } else {
        await applyOfflineRenameSideEffects(username, from, destination, input.to);
      }
      const payload: DocsOutboxPayload = isTrash
        ? { op: "trash", from, destination, to }
        : { op: "rename", from, destination, to: input.to };
      await queueDocsOutbox(username, payload);
      // An editor of this Doc in another tab follows it now, while both are offline.
      if (!isTrash) {
        await moveDocsPath(username, from, docsOutboxPathFromRename(from, destination, input.to));
      }
      return offlineQueuedDriveData(destination);
    },
    listDirectory: async (at, opts) => {
      if (readBrowserOnline()) {
        try {
          const data = await live.listDirectory(at, opts);
          rememberDocsLiveDirectory(username, normalizeApiVirtualPath(at), data.directory.files);
          return data;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      return readDocsOfflineDirectory(username, normalizeApiVirtualPath(at));
    },
    listEntriesByPaths: async (paths, opts) => {
      if (readBrowserOnline()) {
        try {
          return await live.listEntriesByPaths(paths, opts);
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      return readDocsOfflineEntriesByPaths(username, paths);
    },
    deleteItems: async (paths, opts) => {
      if (!readBrowserOnline()) throw new Error(DOCS_DELETE_NEEDS_CONNECTION);
      try {
        return await live.deleteItems(paths, opts);
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts?.signal);
        throw new Error(DOCS_DELETE_NEEDS_CONNECTION);
      }
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
          const paths = await withQueuedStars(username, await live.listStars(opts));
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
          // Every open Docs tab of this person reads its stars again (#1563).
          notifyDocsCachesChanged(username);
          return;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      await applyDocsStarToggle(username, path, input.starred);
      await queueDocsOutbox(username, { op: "star", path, starred: input.starred });
      notifyDocsCachesChanged(username);
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
