import { useCallback, useEffect, useRef } from "react";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useAppToast } from "@/hooks/use-app-toast";
import { useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { syncDriveFileNodesIfStale } from "@/lib/offline/drive/drive-file-node-push";
import {
  syncDriveInboundFromFileNodes,
  type DriveInboundSyncResult,
} from "@/lib/offline/drive/drive-inbound-sync";

const PUSH_TYPES = ["FileNode"] as const;
const NO_TYPES: readonly string[] = [];

function shownPaths(paths: readonly string[]): string {
  return paths.map((path) => (path.startsWith("/") ? path : `/${path}`)).join(", ");
}

/**
 * FileNode/changes on app start, whenever `refreshKey` changes, and on a
 * pushed `FileNode` state that differs from the stored token (#1663).
 * Callers bump `refreshKey` from `useOfflineReconnectFlush`'s `afterFlush`
 * so inbound runs after the outbox flush. No timer and no poll: without push
 * the folder listings still load on navigation.
 */
export function useDriveFileNodeInbound(
  username: string | null | undefined,
  refreshKey: number,
  /** Called once the pull for `refreshKey` finished, whether it worked or not. */
  onSettled?: (refreshKey: number) => void,
): void {
  const { show } = useAppToast();
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const showKept = useCallback(
    (result: DriveInboundSyncResult) => {
      if (result.keptUnsavedPaths.length === 0) return;
      show(docsLabels.keptUnsavedDocumentTitle, {
        description: docsLabels.keptUnsavedDocumentMessage(
          shownPaths(result.keptUnsavedPaths),
          result.keptUnsavedPaths.length,
        ),
      });
    },
    [show],
  );

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void syncDriveInboundFromFileNodes(username)
      .then((result) => {
        if (!cancelled) showKept(result);
      })
      .catch((error: unknown) => {
        console.warn("[drive-inbound] FileNode sync failed", error);
      })
      .finally(() => {
        if (!cancelled) onSettledRef.current?.(refreshKey);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, showKept, username]);

  useJmapStateChange(username ? PUSH_TYPES : NO_TYPES, (states) =>
    username ? syncDriveFileNodesIfStale(username, states, showKept) : true,
  );
}
