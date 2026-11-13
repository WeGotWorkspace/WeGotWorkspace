import { useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { docsSearchFromApiPath, docsSearchFromNodeId } from "@/lib/files/docs-route-search";
import {
  createDocsLocatorDeps,
  rememberDocsLocation,
  type DocsLocatorDeps,
} from "@/docs-core/src/docs-document-locator";

export type UseOpenDocsFileOptions = {
  /**
   * Signed-in live session: the Docs route can resolve `?id=`. Guests and mock
   * mode open by path only.
   */
  canOpenById?: boolean;
  username?: string | null;
  /**
   * The Docs route holds its path lookup (a queued write or the first pull
   * after being offline is pending): open by path and let the route decide.
   */
  holdPathLookup?: boolean;
  deps?: Pick<DocsLocatorDeps, "ownedByQueuedWrite" | "recordLocation">;
};

/**
 * Open a document in the docs editor via same-tab SPA navigation so
 * suite-level state (e.g. an active Meet call) survives the route change.
 *
 * A row that names its FileNode id opens `?id=` straight away (#1976): the
 * listing is the server's answer, so the route needs no path lookup and shows
 * no "Opening document…" frame. Without an id, or when a queued offline create
 * or rename owns the path (the id may then belong to another file, #1563), it
 * opens `?file=` and the route looks the id up as before.
 */
export function useOpenDocsFile({
  canOpenById = false,
  username,
  holdPathLookup = false,
  deps,
}: UseOpenDocsFileOptions = {}) {
  const navigate = useNavigate();
  const locator = useMemo(() => deps ?? createDocsLocatorDeps(username), [deps, username]);
  return useCallback(
    (apiPath: string, nodeId?: string) => {
      const openByPath = () =>
        void navigate({ to: "/docs", search: docsSearchFromApiPath(apiPath) });
      if (!canOpenById || holdPathLookup || !nodeId) {
        openByPath();
        return;
      }
      void (async () => {
        const owned = await locator.ownedByQueuedWrite(apiPath).catch(() => true);
        if (owned) {
          openByPath();
          return;
        }
        rememberDocsLocation(nodeId, apiPath);
        // Same record a path lookup writes, so this link also opens offline later.
        await locator.recordLocation(nodeId, apiPath).catch(() => {});
        void navigate({ to: "/docs", search: docsSearchFromNodeId(nodeId) });
      })();
    },
    [canOpenById, holdPathLookup, locator, navigate],
  );
}
