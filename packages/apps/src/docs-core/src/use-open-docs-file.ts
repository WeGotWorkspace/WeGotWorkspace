import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { docsSearchFromApiPath } from "@/docs-core/src/docs-route-search";

/**
 * Open a document in the docs editor via same-tab SPA navigation so
 * suite-level state (e.g. an active Meet call) survives the route change.
 */
export function useOpenDocsFile() {
  const navigate = useNavigate();
  return useCallback(
    (apiPath: string) => {
      void navigate({
        to: "/docs",
        search: docsSearchFromApiPath(apiPath),
      });
    },
    [navigate],
  );
}
