import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import {
  isEligibleForAutoContentSync,
  readOfflineDeviceContentSettings,
  subscribeOfflineDeviceContentSettings,
  type OfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { driveOutboxApiPath } from "@/lib/offline/drive/drive-outbox-flush";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { readDriveContentSyncProgress } from "@/lib/offline/drive/drive-content-sync";
import { readDriveMetadataSyncProgress } from "@/lib/offline/drive/drive-metadata-sync";
import { hasOfflineFileContent } from "@/lib/offline/shared/content-availability";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { normalizeDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";

function fileApiPath(file: DriveFile): string | null {
  const path = file.apiPath?.trim();
  return path ? normalizeDriveAvailabilityPath(path) : null;
}

function parseFileSizeBytes(file: DriveFile): number | null {
  if (file.kind === "folder") return null;
  const raw = file.size?.replace(/[^\d.]/g, "");
  if (!raw) return 0;
  const kb = Number.parseFloat(raw);
  if (Number.isNaN(kb)) return null;
  if (file.size?.includes("MB")) return Math.round(kb * 1024 * 1024);
  if (file.size?.includes("GB")) return Math.round(kb * 1024 * 1024 * 1024);
  if (file.size?.includes("KB")) return Math.round(kb * 1024);
  return Math.round(kb);
}

const SYNC_POLL_INTERVAL_MS = 1500;

export type DriveRowOfflineState = "available" | "syncing" | "too-large" | "none";

/**
 * Offline state of one row. A running background sync only marks the files it
 * will copy itself: not yet on the device and within the automatic size limit.
 * Folders, files above the limit and files already stored keep their own state.
 */
export function driveRowOfflineState(input: {
  hasLocal: boolean;
  isFolder: boolean;
  sizeBytes: number | null;
  syncRunning: boolean;
  online: boolean;
  settings: OfflineDeviceContentSettings;
}): DriveRowOfflineState {
  if (input.hasLocal) return "available";
  if (input.isFolder) return "none";
  const { settings, sizeBytes } = input;
  if (input.syncRunning && isEligibleForAutoContentSync(sizeBytes, settings)) return "syncing";
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

export function useDriveOfflineAvailability(
  files: readonly DriveFile[],
  enabled: boolean,
  username: string | null | undefined,
): {
  offlineAvailableIds: ReadonlySet<string>;
  offlinePinnedIds: ReadonlySet<string>;
  offlinePendingSyncIds: ReadonlySet<string>;
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
      setIsResolving(false);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    setIsResolving(true);

    void (async () => {
      const settings = readOfflineDeviceContentSettings();
      const [metadataProgress, contentProgress] = await Promise.all([
        readDriveMetadataSyncProgress(username),
        readDriveContentSyncProgress(username),
      ]);
      const outboxRows = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
      const outboxPendingPaths = new Set<string>();
      for (const row of outboxRows) {
        const path = driveOutboxApiPath(row);
        if (path) outboxPendingPaths.add(path);
      }

      const available = new Set<string>();
      const pinned = new Set<string>();
      const pending = new Set<string>();

      // Only the content sync copies file bodies; the metadata crawl writes listings.
      const syncRunning = contentProgress.running;

      await Promise.all(
        files.map(async (file) => {
          const apiPath = fileApiPath(file);
          if (!apiPath) return;

          if (outboxPendingPaths.has(apiPath)) {
            pending.add(file.id);
          }

          const state = driveRowOfflineState({
            hasLocal: await hasOfflineFileContent(username, apiPath),
            isFolder: file.kind === "folder",
            sizeBytes: parseFileSizeBytes(file),
            syncRunning,
            online,
            settings,
          });
          if (state === "available") available.add(file.id);
          else if (state === "syncing") pending.add(file.id);
          else if (state === "too-large") pinned.add(file.id);
        }),
      );

      if (cancelled) return;
      setOfflineAvailableIds(available);
      setOfflinePinnedIds(pinned);
      setOfflinePendingSyncIds(pending);
      setIsResolving(false);

      // Stored blobs do not change the file list, so re-evaluate while a sync
      // runs; the pass after it ends clears the last spinners.
      if (metadataProgress.running || contentProgress.running) {
        pollTimer = setTimeout(() => {
          setRefreshToken((value) => value + 1);
        }, SYNC_POLL_INTERVAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [enabled, fileKeys, files, online, refreshToken, settingsVersion, username]);

  return {
    offlineAvailableIds,
    offlinePinnedIds,
    offlinePendingSyncIds,
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
