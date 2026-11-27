export type SpreadsheetRouteSearch = {
  file?: string;
};

export function parseSpreadsheetRouteSearch(
  search: Record<string, unknown>,
): SpreadsheetRouteSearch {
  return {
    file: typeof search.file === "string" ? search.file : undefined,
  };
}

export function validateSpreadsheetRouteSearch(
  search: Record<string, unknown>,
): SpreadsheetRouteSearch {
  return parseSpreadsheetRouteSearch(search);
}

/** Normalize a drive API path from the `file` search param (always leading `/`). */
export function spreadsheetApiPathFromSearch(file: string | undefined): string | null {
  const trimmed = file?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function spreadsheetSearchFromApiPath(apiPath: string): SpreadsheetRouteSearch {
  return { file: apiPath.replace(/^\/+/, "") };
}
