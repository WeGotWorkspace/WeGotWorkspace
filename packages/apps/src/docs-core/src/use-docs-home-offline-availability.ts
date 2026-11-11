import { useCallback, useEffect, useMemo, useState } from "react";
import { hasDocsCollabOfflinePersistence } from "@/lib/offline/docs/docs-collab-offline-availability";
import {
  listDocsAvailability,
  normalizeDocsAvailabilityPath,
} from "@/lib/offline/docs/docs-availability-store";
import { docsOutboxApiPath } from "@/lib/offline/docs/docs-outbox-flush";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  docsCollabRoomKey,
  hasDocsCollabPendingServerSave,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import {
  getDocsCollabSyncState,
  subscribeDocsCollabSyncState,
} from "@/text-editor-core/docs-collab/docs-collab-sync-registry";
import type { DriveFile } from "@/lib/files/drive-models";

function fileApiPath(file: DriveFile): string | null {
  const path = file.apiPath?.trim();
  return path ? normalizeDocsAvailabilityPath(path) : null;
}

/** Resolves offline auto-sync availability state for Docs home rows. */
export function useDocsHomeOfflineAvailability(
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
  const [offlineAvailableIds, setOfflineAvailableIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [offlinePinnedIds, setOfflinePinnedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [offlinePendingSyncIds, setOfflinePendingSyncIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isResolving, setIsResolving] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const fileKeys = useMemo(
    () => files.map((file) => `${file.id}:${file.apiPath ?? ""}`).join("|"),
    [files],
  );

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    return subscribeDocsCollabSyncState(() => {
      setRefreshToken((value) => value + 1);
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
    setIsResolving(true);

    void (async () => {
      const pinnedPaths = new Set<string>();
      const availabilityRows = await listDocsAvailability(username);
      for (const row of availabilityRows) pinnedPaths.add(row.id);

      const outboxPendingPaths = new Set<string>();
      const outboxRows = await listOutboxMutationsForDomain(username, DOCS_DOMAIN);
      for (const row of outboxRows) {
        const path = docsOutboxApiPath(row);
        if (path) outboxPendingPaths.add(path);
      }

      const available = new Set<string>();
      const pinnedIds = new Set<string>();
      const pendingIds = new Set<string>();

      await Promise.all(
        files.map(async (file) => {
          const apiPath = fileApiPath(file);
          if (!apiPath) return;

          if (pinnedPaths.has(apiPath)) {
            pinnedIds.add(file.id);
          }

          const hasLocal = await hasDocsCollabOfflinePersistence(apiPath);
          if (hasLocal || pinnedPaths.has(apiPath)) {
            available.add(file.id);
          }

          const roomKey = docsCollabRoomKey(apiPath);
          const syncState = getDocsCollabSyncState(roomKey);
          const idbPending = await hasDocsCollabPendingServerSave(apiPath);
          if (syncState.pendingServerSave || idbPending || outboxPendingPaths.has(apiPath)) {
            pendingIds.add(file.id);
          }
        }),
      );

      if (!cancelled) {
        setOfflineAvailableIds(available);
        setOfflinePinnedIds(pinnedIds);
        setOfflinePendingSyncIds(pendingIds);
        setIsResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, fileKeys, files, refreshToken, username]);

  return {
    offlineAvailableIds,
    offlinePinnedIds,
    offlinePendingSyncIds,
    isResolving,
    refresh,
  };
}

export function useDocsHomeOpenGuard({
  isOfflineListing,
  offlineAvailableIds,
  onUnavailable,
}: {
  isOfflineListing: boolean;
  offlineAvailableIds: ReadonlySet<string>;
  onUnavailable: () => void;
}) {
  return useCallback(
    (file: DriveFile) => {
      if (!isOfflineListing || offlineAvailableIds.has(file.id)) {
        return true;
      }
      onUnavailable();
      return false;
    },
    [isOfflineListing, offlineAvailableIds, onUnavailable],
  );
}
