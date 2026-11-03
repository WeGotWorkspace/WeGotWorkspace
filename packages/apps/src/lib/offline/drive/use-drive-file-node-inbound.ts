import { useEffect, useRef } from "react";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useAppToast } from "@/hooks/use-app-toast";
import { syncDriveInboundFromFileNodes } from "@/lib/offline/drive/drive-inbound-sync";

function shownPaths(paths: readonly string[]): string {
  return paths.map((path) => (path.startsWith("/") ? path : `/${path}`)).join(", ");
}

/**
 * FileNode/changes on app start and whenever `refreshKey` changes.
 * Callers bump `refreshKey` from `useOfflineReconnectFlush`'s `afterFlush`
 * so inbound runs after the outbox flush. No timer and no poll.
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
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void syncDriveInboundFromFileNodes(username)
      .then((result) => {
        if (cancelled || result.keptUnsavedPaths.length === 0) return;
        show(docsLabels.keptUnsavedDocumentTitle, {
          description: docsLabels.keptUnsavedDocumentMessage(
            shownPaths(result.keptUnsavedPaths),
            result.keptUnsavedPaths.length,
          ),
        });
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
  }, [refreshKey, show, username]);
}
