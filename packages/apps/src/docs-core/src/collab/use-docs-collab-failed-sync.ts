import { useSyncExternalStore } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import {
  getDocsCollabSyncState,
  subscribeDocsCollabSyncState,
} from "@/text-editor-core/docs-collab/docs-collab-sync-registry";
import { useDocsCollabPendingSync } from "./use-docs-collab-pending-sync";

/**
 * True when the open collab room has a pending server save that failed while online.
 */
export function useDocsCollabFailedSync(
  room: string | null | undefined,
  refreshKey?: number,
): boolean {
  const pending = useDocsCollabPendingSync(room, refreshKey);
  const { online } = useConnectivity();
  const failed = useSyncExternalStore(
    subscribeDocsCollabSyncState,
    () => getDocsCollabSyncState(room ?? undefined).failedSync,
    () => false,
  );

  return Boolean(room && online && pending && failed);
}
