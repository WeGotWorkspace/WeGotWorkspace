import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import {
  ensureTrashFolder,
  listTrashEntryNames,
  resolveFreeName,
} from "@/drive-core/src/drive-batch-utils";
import { normalizeApiVirtualPath, isDriveTrashApiPath } from "@/drive-core/src/drive-path-utils";
import type {
  DriveAPIOperations,
  DriveAppBootstrap,
  DriveUIData,
} from "@/drive-core/src/drive-types";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { clearDocsCollabOfflinePersistence } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import {
  applyDocsStarToggle,
  readDocsStarredPaths,
  writeDocsStarredPaths,
} from "@/lib/offline/docs/docs-stars-store";
import {
  buildOfflineDriveUIData,
  readDirectoryEntriesFromCache,
  readDriveBootstrapFromCache,
  removeDriveEntry,
  removeDriveEntriesUnderPrefix,
  searchDriveEntriesFromCache,
  writeDriveBootstrapToCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { refreshDriveDirectoryCache } from "@/lib/offline/drive/drive-metadata-sync";
import {
  removeDriveAvailability,
  normalizeDriveAvailabilityPath,
} from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import type { DriveOutboxPayload } from "@/lib/offline/drive/drive-outbox-flush";
import {
  encodeUploadFileForOutbox,
  flushDriveOutbox,
  removeOutboxMutationsForDrivePath,
  type DriveOutboxFlushResult,
} from "@/lib/offline/drive/drive-outbox-flush";
import {
  downloadOfflineDriveFile,
  readOfflineDriveFileBlob,
} from "@/lib/offline/drive/drive-offline-read";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";
import {
  rememberOfflineDriveUsername,
  readOfflineDriveUsername,
} from "@/lib/offline/offline-session";

function rethrowUnlessOfflineQueue(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<DriveOutboxFlushResult>();

function runnerFor(username: string): ConnectivitySyncRunner<DriveOutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () => flushDriveOutbox(username));
}

export function getDriveSyncRunner(
  username: string,
): ConnectivitySyncRunner<DriveOutboxFlushResult> {
  return runnerFor(username);
}

async function queueDriveOutbox(username: string, payload: DriveOutboxPayload): Promise<void> {
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: DRIVE_DOMAIN,
    op: payload.op,
    payload: JSON.stringify(payload),
  });
}

async function offlineQueuedDriveData(username: string, cwd: string): Promise<DriveUIData> {
  const cached = await readCachedDriveState(username, cwd);
  if (cached) return cached;

  const bootstrap = await readDriveBootstrapFromCache(username);
  if (bootstrap) {
    return buildOfflineDriveUIData(bootstrap, cwd, []);
  }
  return {
    user: { username: "", name: "", role: "user", roots: [] },
    cwd,
    directory: { location: cwd, files: [] },
  };
}

async function readCachedDriveState(username: string, cwd: string): Promise<DriveUIData | null> {
  const bootstrap = await readDriveBootstrapFromCache(username);
  if (!bootstrap) return null;
  const entries = await readDirectoryEntriesFromCache(username, cwd);
  return buildOfflineDriveUIData(bootstrap, cwd, entries);
}

async function applyOfflineTrashSideEffects(username: string, from: string): Promise<void> {
  const apiPath = normalizeApiVirtualPath(from);
  const room = normalizeDriveAvailabilityPath(apiPath);
  await removeOutboxMutationsForDrivePath(username, apiPath);
  await removeDriveEntry(username, apiPath);
  await removeDriveEntriesUnderPrefix(username, room);
  if (isDocsCollabEditablePath(room)) {
    await clearDocsCollabOfflinePersistence(room);
  }
  await removeDriveContentBlob(username, apiPath);
  await removeDriveAvailability(username, room);
}

async function applyOfflineRenameSideEffects(
  username: string,
  from: string,
  destination: string,
  to: string,
): Promise<void> {
  await applyDriveSidecarPathMigration(username, from, destination, to);
}

export function createHybridDriveOperations(
  username: string,
  bootstrap?: DriveAppBootstrap | null,
): DriveAPIOperations {
  const live = createWgwDriveOperations(bootstrap?.data.cwd ?? "/");
  let cachedBootstrap = bootstrap ?? null;

  const ensureBootstrap = async (): Promise<DriveAppBootstrap | null> => {
    if (cachedBootstrap) return cachedBootstrap;
    cachedBootstrap = await readDriveBootstrapFromCache(username);
    return cachedBootstrap;
  };

  return {
    ...live,
    refreshState: async (opts) => {
      if (readBrowserOnline()) {
        try {
          const data = await live.refreshState(opts);
          const nextBootstrap: DriveAppBootstrap = {
            session: cachedBootstrap?.session ?? {
              user: { username, displayName: username },
            },
            data,
          };
          cachedBootstrap = nextBootstrap;
          await writeDriveBootstrapToCache(username, nextBootstrap);
          rememberOfflineDriveUsername(username);
          await refreshDriveDirectoryCache(username, data.cwd, opts?.signal);
          return data;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      const boot = await ensureBootstrap();
      const cached = boot ? await readCachedDriveState(username, boot.data.cwd) : null;
      if (cached) return cached;
      throw new Error("Drive is not available offline yet.");
    },
    changeDir: async (to, opts) => {
      const target = normalizeApiVirtualPath(to);
      if (readBrowserOnline()) {
        try {
          const data = await live.changeDir(target, opts);
          if (cachedBootstrap) {
            cachedBootstrap = { ...cachedBootstrap, data };
            await writeDriveBootstrapToCache(username, cachedBootstrap);
          }
          await refreshDriveDirectoryCache(username, data.cwd, opts?.signal);
          return data;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      const boot = await ensureBootstrap();
      const cached = boot ? await readCachedDriveState(username, target) : null;
      if (cached) return cached;
      throw new Error("This folder is not available offline.");
    },
    listDirectory: async (at, opts) => {
      const target = normalizeApiVirtualPath(at);
      if (readBrowserOnline()) {
        try {
          const data = await live.listDirectory(target, opts);
          await refreshDriveDirectoryCache(username, data.cwd, opts?.signal);
          return data;
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      const boot = await ensureBootstrap();
      const cached = boot ? await readCachedDriveState(username, target) : null;
      if (cached) return cached;
      throw new Error("This folder is not available offline.");
    },
    search: async (query, opts) => {
      if (readBrowserOnline()) {
        try {
          return await live.search(query, opts);
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      return searchDriveEntriesFromCache(username, query, opts?.limit);
    },
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
          const data = await live.renameItem({ ...input, to }, opts);
          if (isTrash) {
            await applyOfflineTrashSideEffects(username, input.from);
          } else {
            await applyDriveSidecarPathMigration(username, input.from, input.destination, input.to);
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
      const payload: DriveOutboxPayload = isTrash
        ? { op: "trash", from, destination, to }
        : { op: "rename", from, destination, to: input.to };
      await queueDriveOutbox(username, payload);
      return offlineQueuedDriveData(username, destination);
    },
    uploadFiles: async (input, opts) => {
      if (readBrowserOnline()) {
        try {
          return await live.uploadFiles(input, opts);
        } catch (error) {
          rethrowUnlessOfflineQueue(error, opts?.signal);
        }
      }
      const cwd = normalizeApiVirtualPath(input.cwd);
      for (const file of input.files) {
        const encoded = await encodeUploadFileForOutbox(file);
        await queueDriveOutbox(username, {
          op: "upload",
          cwd,
          name: file.name,
          base64: encoded.base64,
          mimeType: encoded.mimeType,
        });
      }
      return offlineQueuedDriveData(username, cwd);
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
      await downloadOfflineDriveFile(username, normalized);
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
      const blob = await readOfflineDriveFileBlob(username, normalized);
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
      await queueDriveOutbox(username, { op: "star", path, starred: input.starred });
    },
  };
}

export async function flushDriveOutboxForAccount(
  username?: string | null,
): Promise<DriveOutboxFlushResult | null> {
  const resolved = username ?? readOfflineDriveUsername();
  if (!resolved) return null;
  return (await runnerFor(resolved).flush()) ?? null;
}
