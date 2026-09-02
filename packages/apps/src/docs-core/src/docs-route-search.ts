export type DocsRouteSearch = {
  file?: string;
};

export function parseDocsRouteSearch(search: Record<string, unknown>): DocsRouteSearch {
  return {
    file: typeof search.file === "string" ? search.file : undefined,
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
  return { file: apiPath.replace(/^\/+/, "") };
}

/** Docs editor URL for a drive API path (`/docs?file=…`). */
export function docsHrefFromApiPath(apiPath: string): string {
  const file = docsSearchFromApiPath(apiPath).file;
  const query = new URLSearchParams();
  if (file) query.set("file", file);
  return `/docs${query.toString() ? `?${query.toString()}` : ""}`;
}
