import {
  DOCS_HOME_LIST_CATEGORIES,
  DOCS_HOME_LIST_EXTENSIONS,
  DOCS_HOME_SOURCES,
} from "@/lib/files/docs-home-listing";

export type DocsListingBrowseFilters = {
  pathPrefix?: string;
  query?: string;
  sources?: readonly string[];
  extensions?: readonly string[];
  categories?: readonly string[];
};

/** Stable cache key for a Docs home browse filter set. */
export function docsListingCacheKey(filters: DocsListingBrowseFilters): string {
  const pathPrefix = filters.pathPrefix?.trim() ?? "";
  const query = filters.query?.trim() ?? "";
  const sources = [...(filters.sources ?? DOCS_HOME_SOURCES)].sort();
  const extensions = [...(filters.extensions ?? DOCS_HOME_LIST_EXTENSIONS)].sort();
  const categories = [...(filters.categories ?? DOCS_HOME_LIST_CATEGORIES)].sort();
  return JSON.stringify({ pathPrefix, query, sources, extensions, categories });
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

/** The filters a cache key was made from, or null for a key in another shape. */
export function docsListingFiltersFromCacheKey(cacheKey: string): DocsListingBrowseFilters | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cacheKey);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const fields = parsed as Record<string, unknown>;
  const sources = stringList(fields.sources);
  const extensions = stringList(fields.extensions);
  const categories = stringList(fields.categories);
  if (typeof fields.pathPrefix !== "string" || typeof fields.query !== "string") return null;
  if (!sources || !extensions || !categories) return null;
  return {
    pathPrefix: fields.pathPrefix || undefined,
    query: fields.query || undefined,
    sources,
    extensions,
    categories,
  };
}
