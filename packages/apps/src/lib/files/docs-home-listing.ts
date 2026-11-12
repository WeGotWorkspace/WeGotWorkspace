import type {
  WgwUnifiedSearchData,
  WgwUnifiedSearchParams,
  WgwUnifiedSearchResult,
} from "@/lib/api/wgw/search";

/**
 * Browse-mode filters for the Docs home listing. The home view lists drive files
 * Docs can open (Markdown + plain text) across My Drive and group drives, backed by
 * unified search browse mode (no `q` required). See the Docs Home Browse plan.
 */
export const DOCS_HOME_SOURCES = ["file"] as const;

export const DOCS_HOME_EXTENSIONS = ["md", "markdown", "txt"] as const;

export const DOCS_HOME_CATEGORIES = ["document"] as const;

/**
 * What the Docs file list shows: the files above plus Word files and Google
 * Drive links, which offer Save as Markdown (#1983). Offline body sync keeps
 * {@link DOCS_HOME_EXTENSIONS}: only those open in the editor.
 */
export const DOCS_HOME_LIST_EXTENSIONS = [...DOCS_HOME_EXTENSIONS, "docx", "gdoc"] as const;

/** The search index files `.gdoc` under `file`, not `document`. */
export const DOCS_HOME_LIST_CATEGORIES = [...DOCS_HOME_CATEGORIES, "file"] as const;

/** Page size for offset/limit pagination (matches the Mail `hasMore` pattern). */
export const DOCS_HOME_PAGE_SIZE = 50;

/** Newest first; ties by search row id, newest first. */
/** Sort raw browse results newest-first (client-side safety net over server order). */
export function sortDocsHomeResults(
  results: readonly WgwUnifiedSearchResult[],
): WgwUnifiedSearchResult[] {
  return [...results].sort((a, b) => {
    const am = a.modifiedAt ?? 0;
    const bm = b.modifiedAt ?? 0;
    if (bm !== am) return bm - am;
    return b.id - a.id;
  });
}

export type DocsHomeFetcher = (
  params: Omit<WgwUnifiedSearchParams, "signal"> & { signal?: AbortSignal },
) => Promise<WgwUnifiedSearchData>;

export type DocsHomeBrowseParams = Omit<WgwUnifiedSearchParams, "signal" | "q" | "offset"> & {
  limit: number;
};

/** Fetch every browse page so offline cache and UI match the full server listing. */
export async function fetchAllDocsHomeListingPages(
  fetcher: DocsHomeFetcher,
  baseParams: DocsHomeBrowseParams,
  query: string,
  signal: AbortSignal,
): Promise<{ results: WgwUnifiedSearchResult[]; hasMore: boolean }> {
  const merged: WgwUnifiedSearchResult[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await fetcher({
      ...baseParams,
      q: query || undefined,
      offset,
      signal,
    });
    if (signal.aborted) {
      return { results: merged, hasMore: merged.length > 0 ? hasMore : false };
    }
    const page = data.results ?? [];
    merged.push(...page);
    hasMore = Boolean(data.hasMore);
    offset = merged.length;
    if (page.length === 0) {
      hasMore = false;
      break;
    }
  }

  return { results: merged, hasMore: false };
}
