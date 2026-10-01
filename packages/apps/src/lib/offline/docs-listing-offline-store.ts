import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import {
  DOCS_HOME_CATEGORIES,
  DOCS_HOME_EXTENSIONS,
  DOCS_HOME_SOURCES,
} from "@/docs-core/src/docs-home-constants";
import { sortDocsHomeResults } from "@/docs-core/src/use-docs-home-list";
import { rememberOfflineDocsUsername } from "@/lib/offline/offline-session";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import {
  docsListingCacheKey,
  type DocsListingBrowseFilters,
} from "@/lib/offline/docs/docs-listing-cache-key";
import { docsListingRowsTable, type OfflineDocsListingRow } from "@/lib/offline/docs/docs-schema";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";

export type DocsListingCacheSnapshot = {
  results: WgwUnifiedSearchResult[];
  hasMore: boolean;
  syncedAt: number;
};

function metaSyncedAtKey(cacheKey: string): string {
  return `docs:listing:${cacheKey}:syncedAt`;
}

function metaHasMoreKey(cacheKey: string): string {
  return `docs:listing:${cacheKey}:hasMore`;
}

function rowId(cacheKey: string, sourceKey: string): string {
  return `${cacheKey}::${sourceKey}`;
}

function serializeResult(result: WgwUnifiedSearchResult): string {
  return JSON.stringify(result);
}

function deserializeResult(payload: string): WgwUnifiedSearchResult {
  return JSON.parse(payload) as WgwUnifiedSearchResult;
}

export async function readDocsListingFromCache(
  username: string,
  filters: DocsListingBrowseFilters,
): Promise<DocsListingCacheSnapshot | null> {
  const cacheKey = docsListingCacheKey(filters);
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await docsListingRowsTable(db).where("cacheKey").equals(cacheKey).toArray();
  if (rows.length === 0) return null;

  const ordered = rows.sort((a, b) => a.sortIndex - b.sortIndex);
  const results = ordered.map((row) => deserializeResult(row.data));
  const syncedAtRaw = await readMeta(username, metaSyncedAtKey(cacheKey));
  const syncedAt = syncedAtRaw ? Number.parseInt(syncedAtRaw, 10) : 0;
  const hasMoreRaw = await readMeta(username, metaHasMoreKey(cacheKey));

  return {
    results: sortDocsHomeResults(results),
    hasMore: hasMoreRaw === "1",
    syncedAt: Number.isFinite(syncedAt) ? syncedAt : 0,
  };
}

export async function writeDocsListingToCache(
  username: string,
  filters: DocsListingBrowseFilters,
  snapshot: Pick<DocsListingCacheSnapshot, "results" | "hasMore">,
): Promise<void> {
  const cacheKey = docsListingCacheKey(filters);
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = docsListingRowsTable(db);
  const syncedAt = Date.now();
  const sorted = sortDocsHomeResults(snapshot.results);

  await table.where("cacheKey").equals(cacheKey).delete();
  const rows: OfflineDocsListingRow[] = sorted.map((result, sortIndex) => ({
    id: rowId(cacheKey, result.sourceKey),
    cacheKey,
    sourceKey: result.sourceKey,
    data: serializeResult(result),
    modifiedAt: result.modifiedAt ?? 0,
    sortIndex,
  }));
  if (rows.length > 0) {
    await table.bulkPut(rows);
  }
  await writeMeta(username, metaSyncedAtKey(cacheKey), String(syncedAt));
  await writeMeta(username, metaHasMoreKey(cacheKey), snapshot.hasMore ? "1" : "0");
  rememberOfflineDocsUsername(username);
}

/** Browse filter sets that should include a file at `apiPath` on Docs home. */
export function docsHomeBrowseFiltersForApiPath(apiPath: string): DocsListingBrowseFilters[] {
  const sourceKey = normalizeApiVirtualPath(apiPath).replace(/^\/+/, "");
  const seen = new Set<string>();
  const filters: DocsListingBrowseFilters[] = [];

  const add = (pathPrefix?: string) => {
    const entry: DocsListingBrowseFilters = {
      pathPrefix: pathPrefix || undefined,
      sources: [...DOCS_HOME_SOURCES],
      extensions: [...DOCS_HOME_EXTENSIONS],
      categories: [...DOCS_HOME_CATEGORIES],
    };
    const key = docsListingCacheKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    filters.push(entry);
  };

  add();
  const segments = sourceKey.split("/").filter(Boolean);
  if (segments[0] === "users" && segments[1]) {
    add(`users/${segments[1]}`);
  } else if (segments[0] === "groups" && segments[1]) {
    add(`groups/${segments[1]}`);
  }
  return filters;
}

/** Synthetic unified-search row for a locally created offline document. */
export function buildOfflineDocsSearchResult(apiPath: string): WgwUnifiedSearchResult {
  const sourceKey = normalizeApiVirtualPath(apiPath).replace(/^\/+/, "");
  const title = sourceKey.split("/").pop() ?? sourceKey;
  const dot = title.lastIndexOf(".");
  const extension = dot >= 0 ? title.slice(dot + 1).toLowerCase() : "md";
  return {
    id: -Math.floor(Date.now() / 1000),
    sourceType: "file",
    sourceKey,
    title,
    extension,
    category: "document",
    size: 0,
    modifiedAt: Math.floor(Date.now() / 1000),
    snippet: "",
  };
}

export function renamedDocsSearchResult(
  existing: WgwUnifiedSearchResult | undefined,
  toApiPath: string,
): WgwUnifiedSearchResult {
  const built = buildOfflineDocsSearchResult(toApiPath);
  if (!existing) return built;
  return {
    ...existing,
    sourceKey: built.sourceKey,
    title: built.title,
    extension: built.extension,
    modifiedAt: built.modifiedAt,
  };
}

function docsListingBrowseFilterSets(apiPath: string): Map<string, DocsListingBrowseFilters> {
  const sets = new Map<string, DocsListingBrowseFilters>();
  for (const filters of docsHomeBrowseFiltersForApiPath(apiPath)) {
    sets.set(docsListingCacheKey(filters), filters);
  }
  return sets;
}

/** Merge a locally created document into relevant Docs home listing caches. */
export async function upsertDocsListingResult(username: string, apiPath: string): Promise<void> {
  await restoreDocsListingResult(username, buildOfflineDocsSearchResult(apiPath));
}

/** Restore a specific browse row into relevant Docs home listing caches (e.g. undo trash). */
export async function restoreDocsListingResult(
  username: string,
  result: WgwUnifiedSearchResult,
): Promise<void> {
  const apiPath = `/${result.sourceKey}`;
  for (const filters of docsHomeBrowseFiltersForApiPath(apiPath)) {
    const cached = await readDocsListingFromCache(username, filters);
    const withoutDuplicate = (cached?.results ?? []).filter(
      (row) => row.sourceKey !== result.sourceKey,
    );
    await writeDocsListingToCache(username, filters, {
      results: [result, ...withoutDuplicate],
      hasMore: false,
    });
  }
}

/** Remove a trashed or deleted document from relevant Docs home listing caches. */
export async function removeDocsListingResult(username: string, apiPath: string): Promise<void> {
  const sourceKey = normalizeApiVirtualPath(apiPath).replace(/^\/+/, "");
  for (const filters of docsHomeBrowseFiltersForApiPath(apiPath)) {
    const cached = await readDocsListingFromCache(username, filters);
    if (!cached) continue;
    const remaining = cached.results.filter((row) => row.sourceKey !== sourceKey);
    if (remaining.length === cached.results.length) continue;
    await writeDocsListingToCache(username, filters, {
      results: remaining,
      hasMore: false,
    });
  }
}

/** Reflect an offline rename/move in relevant Docs home listing caches. */
export async function renameDocsListingResult(
  username: string,
  fromApiPath: string,
  toApiPath: string,
): Promise<void> {
  const oldSourceKey = normalizeApiVirtualPath(fromApiPath).replace(/^\/+/, "");
  const newSourceKey = normalizeApiVirtualPath(toApiPath).replace(/^\/+/, "");
  if (oldSourceKey === newSourceKey) return;

  const filterSets = docsListingBrowseFilterSets(fromApiPath);
  for (const [key, filters] of docsListingBrowseFilterSets(toApiPath)) {
    filterSets.set(key, filters);
  }
  const newPathFilterKeys = new Set(docsListingBrowseFilterSets(toApiPath).keys());

  for (const [cacheKey, filters] of filterSets) {
    const cached = await readDocsListingFromCache(username, filters);
    const oldRow = cached?.results.find((row) => row.sourceKey === oldSourceKey);
    const hadOld = Boolean(oldRow);
    const includeNew = newPathFilterKeys.has(cacheKey);
    if (!hadOld && !includeNew) continue;

    const withoutBoth = (cached?.results ?? []).filter(
      (row) => row.sourceKey !== oldSourceKey && row.sourceKey !== newSourceKey,
    );
    const results = includeNew
      ? [renamedDocsSearchResult(oldRow, toApiPath), ...withoutBoth]
      : withoutBoth;

    await writeDocsListingToCache(username, filters, {
      results,
      hasMore: false,
    });
  }
}
