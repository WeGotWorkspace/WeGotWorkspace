import { isFileNodeId } from "@/lib/files/file-node-id";

/**
 * `/docs?id=fn-…` names the document by its FileNode id and survives a rename
 * or move (#1751). `/docs?file=<path>` is the older form: it still opens, and
 * signed-in sessions swap it for `?id=`. Guests stay on `?file=`.
 */
export type DocsRouteSearch = {
  id?: string;
  file?: string;
};

export function parseDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  const id =
    typeof search.id === "string" && isFileNodeId(search.id)
      ? search.id.trim().toLowerCase()
      : undefined;
  const file = typeof search.file === "string" ? search.file : undefined;
  return {
    ...(id !== undefined ? { id } : {}),
    ...(file !== undefined ? { file } : {}),
  };
}

export function validateDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  return parseDocsRouteSearch(search);
}

/** Normalize a drive API path from the `file` search param (always leading `/`). */
export function docsApiPathFromSearch(file: string | undefined): string | null {
  const trimmed = file?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function docsSearchFromApiPath(apiPath: string): DocsRouteSearch {
  return {
    file: apiPath.replace(/^\/+/, ""),
  };
}

export function docsSearchFromNodeId(nodeId: string): DocsRouteSearch {
  return { id: nodeId };
}

/** Docs editor URL for a drive API path (`/docs?file=…`). */
export function docsHrefFromApiPath(apiPath: string): string {
  const search = docsSearchFromApiPath(apiPath);
  const query = new URLSearchParams();
  if (search.file) query.set("file", search.file);
  return `/docs${query.toString() ? `?${query.toString()}` : ""}`;
}

/** Docs editor URL for a FileNode id (`/docs?id=fn-…`). */
export function docsHrefFromNodeId(nodeId: string): string {
  return `/docs?${new URLSearchParams({ id: nodeId }).toString()}`;
}
