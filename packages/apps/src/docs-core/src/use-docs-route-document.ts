import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  docsApiPathFromSearch,
  docsSearchFromApiPath,
  docsSearchFromNodeId,
  type DocsRouteSearch,
} from "@/docs-core/src/docs-route-search";
import {
  createDocsLocatorDeps,
  justLocatedDocsPath,
  knownDocsPath,
  locateDocsById,
  locateDocsByPath,
  rememberDocsLocation,
  type DocsLocatorDeps,
} from "@/docs-core/src/docs-document-locator";

export type DocsRouteDocument =
  | { status: "home" }
  | { status: "resolving"; nodeId?: string }
  | { status: "ready"; path: string; nodeId?: string }
  | { status: "not-found"; nodeId: string; offline: boolean };

type IdState =
  | { id: string; status: "ready"; path: string }
  | { id: string; status: "not-found"; offline: boolean };

type Options = {
  search: DocsRouteSearch;
  /** Signed-in live session. Guests and mock mode have no id endpoint. */
  canResolve: boolean;
  username: string | null | undefined;
  /** Bumped on reconnect / inbound refresh: re-check where the open Doc lives. */
  refreshKey: number;
  deps?: DocsLocatorDeps;
};

/**
 * Route search → the Doc to open (#1751). `?id=` resolves to the current path,
 * and is re-checked on `refreshKey` and when the tab is shown again, so a rename
 * elsewhere moves the editor to the new path. `?file=` waits for its id and is
 * replaced by `?id=`: the editor's local copy is keyed by id, so opening on the
 * path first would leave typed text behind after a rename. Without an id
 * (offline, unknown file) it opens by path.
 */
export function useDocsRouteDocument({ search, canResolve, username, refreshKey, deps }: Options) {
  const navigate = useNavigate();
  const locator = useMemo(() => deps ?? createDocsLocatorDeps(username), [deps, username]);
  const id = search.id;
  const filePath = id ? null : docsApiPathFromSearch(search.file);
  const [idState, setIdState] = useState<IdState | null>(null);
  /** A `?file=` link whose id could not be found: open it by path. */
  const [pathOnly, setPathOnly] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(0);
  /** The id the lookup effect last ran for: its first run may reuse a fresh answer. */
  const checkedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setRecheck((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (!canResolve) {
      setIdState({ id, status: "not-found", offline: false });
      return;
    }
    const firstForId = checkedIdRef.current !== id;
    checkedIdRef.current = id;
    const fresh = firstForId ? justLocatedDocsPath(id) : undefined;
    if (fresh) {
      setIdState({ id, status: "ready", path: fresh });
      return;
    }
    const controller = new AbortController();
    void locateDocsById(id, locator, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setIdState((current) => {
          const opened = current?.id === id && current.status === "ready";
          if (result.kind === "found") {
            rememberDocsLocation(id, result.path);
            return { id, status: "ready", path: result.path };
          }
          // Once open, a Doc that is gone or unreachable stays mounted: the
          // editor's own "document gone" flow keeps the local copy.
          if (opened) return current;
          const known = knownDocsPath(id);
          if (known) return { id, status: "ready", path: known };
          return { id, status: "not-found", offline: result.kind === "unknown" };
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [canResolve, id, locator, recheck, refreshKey]);

  useEffect(() => {
    if (id || !filePath || !canResolve) return;
    const controller = new AbortController();
    void locateDocsByPath(filePath, locator, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind !== "found") {
          setPathOnly(filePath);
          return;
        }
        rememberDocsLocation(result.id, result.path);
        void navigate({ to: "/docs", search: docsSearchFromNodeId(result.id), replace: true });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [canResolve, filePath, id, locator, navigate, refreshKey]);

  /** The open Doc now lives at `path` (renamed inside Docs). */
  const followPath = useCallback(
    (path: string) => {
      if (id) {
        rememberDocsLocation(id, path);
        setIdState({ id, status: "ready", path });
        return;
      }
      void navigate({ to: "/docs", search: docsSearchFromApiPath(path) });
    },
    [id, navigate],
  );

  const retry = useCallback(() => setRecheck((n) => n + 1), []);

  const openPathRef = useRef<string | null>(null);
  /**
   * A save to the open path was refused as gone. `true` when the id lives
   * elsewhere now and the editor moves there; `false` when it is really gone.
   */
  const relocate = useCallback(async (): Promise<boolean> => {
    if (!id || !canResolve) return false;
    const result = await locateDocsById(id, locator).catch(() => null);
    if (result?.kind !== "found" || result.path === openPathRef.current) return false;
    rememberDocsLocation(id, result.path);
    setIdState({ id, status: "ready", path: result.path });
    return true;
  }, [canResolve, id, locator]);

  let routeDocument: DocsRouteDocument;
  if (!id) {
    if (!filePath) routeDocument = { status: "home" };
    else if (!canResolve || pathOnly === filePath)
      routeDocument = { status: "ready", path: filePath };
    else routeDocument = { status: "resolving" };
  } else if (idState?.id === id) {
    routeDocument =
      idState.status === "ready"
        ? { status: "ready", path: idState.path, nodeId: id }
        : { status: "not-found", nodeId: id, offline: idState.offline };
  } else {
    const known = knownDocsPath(id);
    routeDocument = known
      ? { status: "ready", path: known, nodeId: id }
      : { status: "resolving", nodeId: id };
  }

  const openPath = routeDocument.status === "ready" ? routeDocument.path : null;
  useEffect(() => {
    openPathRef.current = openPath;
  }, [openPath]);

  return { document: routeDocument, followPath, retry, relocate };
}
