import { useEffect } from "react";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useAppToast } from "@/hooks/use-app-toast";
import { syncDriveInboundFromFileNodes } from "@/lib/offline/drive/drive-inbound-sync";

/**
 * FileNode/changes on app start and whenever `refreshKey` changes.
 * Callers bump `refreshKey` from `useOfflineReconnectFlush`'s `afterFlush`
 * so inbound runs after the outbox flush. No timer and no poll.
 */
export function useDriveFileNodeInbound(
  username: string | null | undefined,
  refreshKey: number,
): void {
  const { showError } = useAppToast();
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void syncDriveInboundFromFileNodes(username)
      .then((result) => {
        if (cancelled || result.keptUnsavedPaths.length === 0) return;
        showError(docsLabels.keptUnsavedDocumentTitle, {
          description: docsLabels.keptUnsavedDocumentMessage,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey, showError, username]);
}
