import { docsSearchFromApiPath } from "@/docs-core/src/docs-route-search";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";

const MARKDOWN_EXT = /\.(md|markdown)$/i;

export type ShareDestinationRoute = {
  to: "/docs" | "/drive";
  search: Record<string, string>;
};

function lastPathSegment(apiPath: string): string {
  const normalized = normalizeApiVirtualPath(apiPath);
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function isMarkdownSharePath(apiPath: string): boolean {
  return MARKDOWN_EXT.test(lastPathSegment(normalizeApiVirtualPath(apiPath)));
}

/** Typed router destination after a public share session is established. */
export function shareDestinationRoute(apiPath: string): ShareDestinationRoute {
  const normalized = normalizeApiVirtualPath(apiPath);
  if (isMarkdownSharePath(normalized)) {
    const search = docsSearchFromApiPath(normalized);
    return {
      to: "/docs",
      search: search.file ? { file: search.file } : {},
    };
  }
  return { to: "/drive", search: { view: "shared" } };
}

/** Route guests to Docs for markdown shares; otherwise open Drive shared view. */
export function shareDestinationHref(apiPath: string): string {
  const route = shareDestinationRoute(apiPath);
  const params = new URLSearchParams(route.search);
  const qs = params.toString();
  return `${route.to}${qs ? `?${qs}` : ""}`;
}
