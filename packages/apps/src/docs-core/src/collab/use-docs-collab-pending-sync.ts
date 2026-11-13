import { useSyncExternalStore } from "react";
import {
  getDocsCollabSyncState,
  subscribeDocsCollabSyncState,
} from "@/text-editor-core/docs-collab/docs-collab-sync-registry";

/**
 * True when the open collab room has unsynced local changes waiting for a server save.
 */
export function useDocsCollabPendingSync(
  room: string | null | undefined,
  _refreshKey?: number,
): boolean {
  const pending = useSyncExternalStore(
    subscribeDocsCollabSyncState,
    () => getDocsCollabSyncState(room ?? undefined).pendingServerSave,
    () => false,
  );

  return Boolean(room && pending);
}
