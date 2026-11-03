import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import type { PendingWrite } from "@/lib/offline/core/inbound-sync";
import {
  docsListingFiltersFromCacheKey,
  type DocsListingBrowseFilters,
} from "@/lib/offline/docs/docs-listing-cache-key";
import type { OfflineDocsListingRow } from "@/lib/offline/docs/docs-schema";

/**
 * Pure half of Docs inbound (#1563): which rows of the cached Docs home views
 * change for a set of FileNode outcomes. No IndexedDB here.
 */

/** What a queued Docs write owns: the row at its path, or only the star. */
export type DocsPendingField = "location" | "starred";
export type DocsPendingWrites = ReadonlyMap<string, PendingWrite<DocsPendingField>>;

/** The FileNode facts a listing row needs. `modifiedAt` is in seconds. */
export type DocsNodeFacts = { directory: boolean; size: number; modifiedAt: number };

/**
 * One FileNode outcome from Drive inbound, by path:
 * - `removed`: destroyed elsewhere and dropped locally (no unsaved text kept).
 * - `moved`: renamed or moved; a folder moves every path under it.
 * - `upserted`: created or changed in place.
 */
export type DocsInboundChange =
  | { kind: "removed"; path: string }
  | { kind: "moved"; from: string; to: string; node: DocsNodeFacts }
  | { kind: "upserted"; path: string; node: DocsNodeFacts };

/** Listing `sourceKey` for an API path: no leading or trailing slash. */
export function docsSourceKey(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

/** A queued create or rename target owns the row at this path. */
export function docsRowOwnedByQueuedWrite(pending: DocsPendingWrites, key: string): boolean {
  const write = pending.get(key);
  return Boolean(write && !write.deleting && write.fields.has("location"));
}

/** A queued trash or rename moves the Doc away from this path. */
export function docsRowHiddenByQueuedWrite(pending: DocsPendingWrites, key: string): boolean {
  return pending.get(key)?.deleting === true;
}

/**
 * Whether a browse view lists `sourceKey`: a file with a Docs extension, no
 * dot segment (the API indexes no `.Trash`, `.notes` or hidden path), under
 * the view's drive prefix. The query of a search view is not evaluated here.
 */
export function docsViewIncludesPath(
  filters: DocsListingBrowseFilters,
  sourceKey: string,
): boolean {
  const segments = sourceKey.split("/");
  if (segments.some((segment) => segment === "" || segment.startsWith("."))) return false;
  const name = segments[segments.length - 1] ?? "";
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  // Every cache key spells its extensions out (`docsListingCacheKey`).
  const extensions = filters.extensions ?? [];
  if (!name.includes(".") || !extensions.includes(extension)) return false;
  const prefix = (filters.pathPrefix ?? "").replace(/^\/+|\/+$/g, "");
  return !prefix || sourceKey.startsWith(`${prefix}/`);
}

function isSearchView(filters: DocsListingBrowseFilters): boolean {
  return Boolean(filters.query?.trim());
}

function fileName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

/** A row for a Doc no view has yet. The next live listing replaces it by `sourceKey`. */
function arrivedResult(key: string, node: DocsNodeFacts): WgwUnifiedSearchResult {
  const title = fileName(key);
  return {
    id: 0,
    sourceType: "file",
    sourceKey: key,
    title,
    extension: extensionOf(title),
    category: "document",
    size: node.size,
    modifiedAt: node.modifiedAt,
    snippet: "",
  };
}

function movedResult(
  existing: WgwUnifiedSearchResult,
  key: string,
  node: DocsNodeFacts | undefined,
): WgwUnifiedSearchResult {
  const title = fileName(key);
  return {
    ...existing,
    sourceKey: key,
    title,
    extension: extensionOf(title),
    ...(node ? { size: node.size, modifiedAt: node.modifiedAt || existing.modifiedAt } : {}),
  };
}

type View = {
  filters: DocsListingBrowseFilters;
  results: Map<string, WgwUnifiedSearchResult>;
  changed: boolean;
};

function readViews(rows: readonly OfflineDocsListingRow[]): Map<string, View> {
  const views = new Map<string, View>();
  for (const row of rows) {
    let view = views.get(row.cacheKey);
    if (!view) {
      const filters = docsListingFiltersFromCacheKey(row.cacheKey);
      if (!filters) continue;
      view = { filters, results: new Map(), changed: false };
      views.set(row.cacheKey, view);
    }
    view.results.set(row.sourceKey, JSON.parse(row.data) as WgwUnifiedSearchResult);
  }
  return views;
}

type Planner = {
  views: Map<string, View>;
  pending: DocsPendingWrites;
  /** Rows that moved or appeared, for the browse views that lack them. */
  arrived: Map<string, WgwUnifiedSearchResult>;
};

function applyRemoved(planner: Planner, path: string): void {
  const key = docsSourceKey(path);
  if (docsRowOwnedByQueuedWrite(planner.pending, key)) return;
  planner.arrived.delete(key);
  for (const view of planner.views.values()) {
    if (view.results.delete(key)) view.changed = true;
  }
}

function applyMoved(planner: Planner, change: Extract<DocsInboundChange, { kind: "moved" }>): void {
  const from = docsSourceKey(change.from);
  const to = docsSourceKey(change.to);
  if (from === to) return;
  let seen = false;
  for (const view of planner.views.values()) {
    for (const [key, result] of [...view.results]) {
      if (key !== from && !key.startsWith(`${from}/`)) continue;
      seen = true;
      // The local name stays until the queued write settles.
      if (docsRowOwnedByQueuedWrite(planner.pending, key)) continue;
      view.results.delete(key);
      view.changed = true;
      const next = `${to}${key.slice(from.length)}`;
      if (docsRowHiddenByQueuedWrite(planner.pending, next)) continue;
      if (docsRowOwnedByQueuedWrite(planner.pending, next)) continue;
      const moved = movedResult(result, next, key === from ? change.node : undefined);
      if (docsViewIncludesPath(view.filters, next)) view.results.set(next, moved);
      planner.arrived.set(next, moved);
    }
  }
  if (!seen && !change.node.directory) applyUpserted(planner, change.to, change.node);
}

function applyUpserted(planner: Planner, path: string, node: DocsNodeFacts): void {
  const key = docsSourceKey(path);
  if (node.directory) return;
  if (docsRowOwnedByQueuedWrite(planner.pending, key)) return;
  if (docsRowHiddenByQueuedWrite(planner.pending, key)) return;
  let known: WgwUnifiedSearchResult | undefined;
  for (const view of planner.views.values()) {
    const existing = view.results.get(key);
    if (!existing) continue;
    const next = {
      ...existing,
      size: node.size,
      modifiedAt: node.modifiedAt || existing.modifiedAt,
    };
    known ??= next;
    if (next.size === existing.size && next.modifiedAt === existing.modifiedAt) continue;
    view.results.set(key, next);
    view.changed = true;
  }
  planner.arrived.set(key, known ?? arrivedResult(key, node));
}

/**
 * Apply FileNode outcomes to every cached Docs home view. Rows a queued write
 * owns stay as the user left them, and a path a queued trash or rename left is
 * not brought back. Search views only lose, rename or update rows they had.
 * Returns the views that changed, as their full result lists.
 */
export function planDocsListingInbound(
  rows: readonly OfflineDocsListingRow[],
  changes: readonly DocsInboundChange[],
  pending: DocsPendingWrites,
): Map<string, WgwUnifiedSearchResult[]> {
  const planner: Planner = { views: readViews(rows), pending, arrived: new Map() };
  for (const change of changes) {
    if (change.kind === "removed") applyRemoved(planner, change.path);
    else if (change.kind === "moved") applyMoved(planner, change);
    else applyUpserted(planner, change.path, change.node);
  }
  for (const [key, result] of planner.arrived) {
    for (const view of planner.views.values()) {
      if (isSearchView(view.filters) || view.results.has(key)) continue;
      if (!docsViewIncludesPath(view.filters, key)) continue;
      view.results.set(key, result);
      view.changed = true;
    }
  }
  const changed = new Map<string, WgwUnifiedSearchResult[]>();
  for (const [cacheKey, view] of planner.views) {
    if (view.changed) changed.set(cacheKey, [...view.results.values()]);
  }
  return changed;
}
