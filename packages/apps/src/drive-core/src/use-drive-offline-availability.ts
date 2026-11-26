import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import {
  readOfflineDeviceContentSettings,
  subscribeOfflineDeviceContentSettings,
  type OfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { driveOutboxApiPath } from "@/lib/offline/drive/drive-outbox-flush";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import {
  isDriveContentQueued,
  readDriveContentFailures,
  subscribeDriveContentRunState,
} from "@/lib/offline/drive/drive-content-run-state";
import { hasOfflineFileContent } from "@/lib/offline/shared/content-availability";
import type { DriveFile } from "@/lib/files/drive-models";
import { parseFileSizeBytes } from "@/lib/files/file-name-utils";
import { normalizeDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";

function fileApiPath(file: DriveFile): string | null {
  const path = file.apiPath?.trim();
  return path ? normalizeDriveAvailabilityPath(path) : null;
}

/** Row refreshes while the copy runs: at most one per this many ms. */
const RUN_STATE_REFRESH_MS = 750;

export type DriveRowOfflineState = "available" | "syncing" | "failed" | "too-large" | "none";

/**
 * Offline state of one row (#2063 measurement 2):
 * - a row spins only while the current run will still download that file,
 *   and never while the device is offline;
 * - a file whose automatic download failed shows as failed, also while a
 *   later run retries it, until a copy is stored.
 * Folders, files above the limit and files already stored keep their own state.
 */
export function driveRowOfflineState(input: {
  hasLocal: boolean;
  isFolder: boolean;
  sizeBytes: number | null;
  queued: boolean;
  failed: boolean;
  online: boolean;
  settings: OfflineDeviceContentSettings;
}): DriveRowOfflineState {
  if (input.hasLocal) return "available";
  if (input.isFolder) return "none";
  const { settings, sizeBytes } = input;
  if (input.failed) return "failed";
  if (input.queued && input.online) return "syncing";
  if (
    input.online &&
    settings.contentSyncEnabled &&
    sizeBytes != null &&
    sizeBytes > settings.maxFileSizeBytes
  ) {
    return "too-large";
  }
  return "none";
}

/** A failure counts only for the version it was recorded for; a newer upload starts over. */
function isCurrentVersionFailure(
  failure: { modifiedAt: number } | undefined,
  file: DriveFile,
): boolean {
  if (!failure) return false;
  if (file.modifiedMs == null) return true;
  return Math.abs(failure.modifiedAt - file.modifiedMs / 1000) < 1;
}

export function useDriveOfflineAvailability(
  files: readonly DriveFile[],
  enabled: boolean,
  username: string | null | undefined,
): {
  offlineAvailableIds: ReadonlySet<string>;
  offlinePinnedIds: ReadonlySet<string>;
  offlinePendingSyncIds: ReadonlySet<string>;
  offlineFailedIds: ReadonlySet<string>;
  isResolving: boolean;
  refresh: () => void;
} {
  const { online } = useConnectivity();
  const [offlineAvailableIds, setOfflineAvailableIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [offlinePinnedIds, setOfflinePinnedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [offlinePendingSyncIds, setOfflinePendingSyncIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [offlineFailedIds, setOfflineFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isResolving, setIsResolving] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const fileKeys = useMemo(
    () => files.map((file) => `${file.id}:${file.apiPath ?? ""}`).join("|"),
    [files],
  );

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    return subscribeOfflineDeviceContentSettings(() => {
      setSettingsVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !username || files.length === 0) {
      setOfflineAvailableIds(new Set());
      setOfflinePinnedIds(new Set());
      setOfflinePendingSyncIds(new Set());
      setOfflineFailedIds(new Set());
      setIsResolving(false);
      return;
    }

    let cancelled = false;
    setIsResolving(true);

    void (async () => {
      const settings = readOfflineDeviceContentSettings();
      const failures = await readDriveContentFailures(username);
      const outboxRows = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
      const outboxPendingPaths = new Set<string>();
      for (const row of outboxRows) {
        const path = driveOutboxApiPath(row);
        if (path) outboxPendingPaths.add(path);
      }

      const available = new Set<string>();
      const pinned = new Set<string>();
      const pending = new Set<string>();
      const failed = new Set<string>();

      await Promise.all(
        files.map(async (file) => {
          const apiPath = fileApiPath(file);
          if (!apiPath) return;

          if (outboxPendingPaths.has(apiPath)) {
            pending.add(file.id);
          }

          const failure = failures[apiPath.replace(/^\/+/, "")];
          const state = driveRowOfflineState({
            hasLocal: await hasOfflineFileContent(username, apiPath),
            isFolder: file.kind === "folder",
            sizeBytes: parseFileSizeBytes(file),
            queued: isDriveContentQueued(username, apiPath),
            failed: isCurrentVersionFailure(failure, file),
            online,
            settings,
          });
          if (state === "available") available.add(file.id);
          else if (state === "syncing") pending.add(file.id);
          else if (state === "failed") failed.add(file.id);
          else if (state === "too-large") pinned.add(file.id);
        }),
      );

      if (cancelled) return;
      setOfflineAvailableIds(available);
      setOfflinePinnedIds(pinned);
      setOfflinePendingSyncIds(pending);
      setOfflineFailedIds(failed);
      setIsResolving(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, fileKeys, files, online, refreshToken, settingsVersion, username]);

  // Stored blobs do not change the file list: re-read when the copy's queue
  // or failures change, throttled so a fast run does not re-render every file.
  useEffect(() => {
    if (!enabled || !username) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeDriveContentRunState(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setRefreshToken((value) => value + 1);
      }, RUN_STATE_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, username]);

  return {
    offlineAvailableIds,
    offlinePinnedIds,
    offlinePendingSyncIds,
    offlineFailedIds,
    isResolving,
    refresh,
  };
}

export function useDriveOfflineOpenGuard(
  files: readonly DriveFile[],
  offlineAvailableIds: ReadonlySet<string>,
  enabled: boolean,
): (file: DriveFile) => boolean {
  const { online } = useConnectivity();
  return useCallback(
    (file: DriveFile) => {
      if (!enabled || online || file.kind === "folder") return true;
      return offlineAvailableIds.has(file.id);
    },
    [enabled, offlineAvailableIds, online],
  );
}
