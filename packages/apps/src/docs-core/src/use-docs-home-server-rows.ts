import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveShareOperations } from "@/lib/files/drive-types";
import {
  DOCS_HOME_LIST_CATEGORIES,
  DOCS_HOME_LIST_EXTENSIONS,
  DOCS_HOME_PAGE_SIZE,
  DOCS_HOME_SOURCES,
  sortDocsHomeResults,
  type DocsHomeFetcher,
} from "@/lib/files/docs-home-listing";
import { uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import {
  apiPathFromSearchSourceKey,
  driveFileFromSearchResult,
  driveLocationLabel,
} from "@/drive-core/src/drive-search-utils";
import { fetchDriveSharedWithMeListing } from "@/drive-core/src/drive-shared-listing";
import { fetchDriveStarredListing } from "@/drive-core/src/drive-starred-listing";
import { fetchDriveTrashListing } from "@/drive-core/src/drive-trash-listing";
import { isDriveUnderTrash } from "@/drive-core/src/drive-visible-items";
import { type DocsHomeGroupRoot } from "@/docs-core/src/docs-home-drives";
import {
  docsHomeBrowsePathPrefix,
  filterDocsHomeSharedByQuery,
  isDocsHomeCompatibleSharedFile,
  type DocsHomeView,
} from "@/docs-core/src/docs-home-shared";
import { docsRowLocation } from "@/docs-core/src/docs-home-tree-rows";

/**
 * Docs home rows from the server (#2063 C4), for two cases only:
 * - content search: a query in All Docs, Recent or a drive searches document
 *   text on the server (`/search/results`), page by page;
 * - no local tree (Storybook and test mocks): every view lists from the server.
 * The live app lists everything else from the device's file tree.
 */

/** Map search results to `DriveFile`s (deduped by source key, newest first). */
export function mapDocsHomeResults(
  results: readonly WgwUnifiedSearchResult[],
  username: string,
  options: { personalDriveLabel: string; groupRoots?: readonly DocsHomeGroupRoot[] },
): DriveFile[] {
  const seen = new Set<string>();
  const files: DriveFile[] = [];
  for (const result of sortDocsHomeResults(results)) {
    const apiPath = apiPathFromSearchSourceKey(result.sourceKey);
    if (!apiPath || seen.has(result.sourceKey)) continue;
    seen.add(result.sourceKey);
    const file = driveFileFromSearchResult(
      result,
      uiPathFromApiPath(apiPath, username),
      apiPath,
      username,
    );
    const driveLocation = driveLocationLabel(result.sourceKey, username);
    files.push(
      driveLocation
        ? {
            ...file,
            location: docsRowLocation(driveLocation, result.sourceKey, options),
          }
        : file,
    );
  }
  return files;
}

type ServerPage = { files: DriveFile[]; hasMore: boolean };

/** One server listing: `key` names it, `loadPage` reads the page at `offset`. */
type ServerSource = {
  key: string;
  loadPage: (offset: number, signal: AbortSignal) => Promise<ServerPage>;
};

export type DocsHomeServerRowsArgs = {
  /** False: no server listing (the tree answers). */
  enabled: boolean;
  /** Content search only: the views that can list by browse use it with `query`. */
  searchOnly: boolean;
  username: string;
  view: DocsHomeView;
  /** Debounced query. */
  query: string;
  fetcher?: DocsHomeFetcher;
  operations?: Pick<DriveAPIOperations, "listStars" | "listEntriesByPaths" | "listDirectory">;
  shareOperations?: Pick<DriveShareOperations, "listSharedWithMe">;
  personalDriveLabel: string;
  groupRoots?: readonly DocsHomeGroupRoot[];
};

function browseSource(args: DocsHomeServerRowsArgs): ServerSource | null {
  const { fetcher, view, query } = args;
  if (!fetcher) return null;
  const pathPrefix = docsHomeBrowsePathPrefix(view);
  return {
    key: JSON.stringify(["browse", pathPrefix ?? "", query]),
    // Every page at once, as the listing did: the pane sorts the rows (by
    // name, say), so a later page may hold the first row.
    loadPage: async (_offset, signal) => {
      const results: WgwUnifiedSearchResult[] = [];
      for (;;) {
        const data = await fetcher({
          sources: [...DOCS_HOME_SOURCES],
          extensions: [...DOCS_HOME_LIST_EXTENSIONS],
          categories: [...DOCS_HOME_LIST_CATEGORIES],
          limit: DOCS_HOME_PAGE_SIZE,
          offset: results.length,
          ...(pathPrefix ? { pathPrefix } : {}),
          ...(query ? { q: query } : {}),
          signal,
        });
        const page = data.results ?? [];
        results.push(...page);
        if (signal.aborted || !data.hasMore || page.length === 0) break;
      }
      return { files: mapDocsHomeResults(results, args.username, args), hasMore: false };
    },
  };
}

/** The server listing of a mock view (no local tree): Drive's loaders, Docs files only. */
function viewSource(args: DocsHomeServerRowsArgs): ServerSource | null {
  const { view, username, operations, shareOperations } = args;
  const whole = (load: (signal: AbortSignal) => Promise<DriveFile[]>): ServerSource => ({
    key: view.type,
    loadPage: async (_offset, signal) => ({
      files: (await load(signal)).filter(isDocsHomeCompatibleSharedFile),
      hasMore: false,
    }),
  });
  switch (view.type) {
    case "starred":
      return operations?.listStars
        ? whole(async (signal) =>
            (await fetchDriveStarredListing(operations, username, { signal })).files.filter(
              (file) => !isDriveUnderTrash(file.parent),
            ),
          )
        : null;
    case "shared":
      return shareOperations?.listSharedWithMe
        ? whole((signal) => fetchDriveSharedWithMeListing(shareOperations, username, { signal }))
        : null;
    case "trash":
      return operations?.listDirectory && username.trim()
        ? whole((signal) => fetchDriveTrashListing(operations, username, { signal }))
        : null;
    default:
      return browseSource(args);
  }
}

/** Views whose search is a content search on the server. */
export function docsHomeViewSearchesContent(view: DocsHomeView): boolean {
  return view.type === "all" || view.type === "recent" || view.type === "drive";
}

export function useDocsHomeServerRows(args: DocsHomeServerRowsArgs) {
  const { enabled, searchOnly, query, view } = args;
  const source = useMemo(
    () => (!enabled ? null : searchOnly ? browseSource(args) : viewSource(args)),
    // The source is keyed by its content below; the loaders read the latest args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, searchOnly, view, query, args.fetcher, args.operations, args.shareOperations],
  );
  const sourceKey = source ? `${searchOnly ? "search" : "view"}:${source.key}` : null;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(source !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    const current = sourceRef.current;
    if (!current) {
      setFiles((previous) => (previous.length === 0 ? previous : []));
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    current.loadPage(0, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return;
        setFiles(page.files);
        setHasMore(page.hasMore);
        setLoading(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setFiles([]);
        setHasMore(false);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load documents");
      },
    );
    return () => controller.abort();
  }, [sourceKey, reloadToken]);

  const loadMore = useCallback(() => {
    const current = sourceRef.current;
    if (!current || loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const controller = new AbortController();
    current.loadPage(filesRef.current.length, controller.signal).then(
      (page) => {
        setFiles((previous) => [...previous, ...page.files]);
        setHasMore(page.hasMore);
        setLoadingMore(false);
      },
      (err: unknown) => {
        setLoadingMore(false);
        setError(err instanceof Error ? err.message : "Failed to load documents");
      },
    );
  }, [hasMore, loading, loadingMore]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // Starred, Shared and Trash of a mock list whole; the query narrows names here.
  const shown = useMemo(
    () =>
      searchOnly || docsHomeViewSearchesContent(view)
        ? files
        : filterDocsHomeSharedByQuery(files, query),
    [files, query, searchOnly, view],
  );

  return { files: shown, loading, loadingMore, hasMore, error, loadMore, reload };
}
