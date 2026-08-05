import { docsSearchFromApiPath } from "@/docs-core/src/docs-route-search";
import { extensionFromFileName } from "@/drive-core/src/drive-file-utils";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import { fileSupportsTextPreview } from "@/lib/file-preview/file-preview-utils";
import { normalizeApiVirtualPath as normalizeSharePath, parentAndName } from "@/lib/files/api-path";

const MARKDOWN_EXT = /\.(md|markdown)$/i;
const BROWSER_PREVIEW_MEDIA_EXT =
  /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|mp4|mpe?g|webm|mov|m4v|mkv)$/i;

export type ShareDestinationRoute = {
  to: "/docs" | "/drive";
  search: Record<string, string>;
};

export type ShareDestination =
  | { kind: "route"; route: ShareDestinationRoute }
  | { kind: "download"; apiPath: string };

function lastPathSegment(apiPath: string): string {
  const normalized = normalizeApiVirtualPath(apiPath);
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function isMarkdownSharePath(apiPath: string): boolean {
  return MARKDOWN_EXT.test(lastPathSegment(normalizeApiVirtualPath(apiPath)));
}

/** True when the shared API path points at a file (last segment has an extension). */
export function isShareTargetFile(apiPath: string): boolean {
  return extensionFromFileName(lastPathSegment(apiPath)) !== "";
}

/** Non-markdown share files that cannot be previewed in Drive/Docs should download. */
export function shareFileShouldDownload(apiPath: string): boolean {
  const normalized = normalizeSharePath(apiPath);
  if (!isShareTargetFile(normalized) || isMarkdownSharePath(normalized)) {
    return false;
  }
  const fileName = lastPathSegment(normalized);
  if (BROWSER_PREVIEW_MEDIA_EXT.test(fileName)) {
    return false;
  }
  return !fileSupportsTextPreview(fileName, "file", normalized);
}

function shareFolderUiPath(apiPath: string): string {
  const normalized = normalizeSharePath(apiPath);
  const scopedPath = isShareTargetFile(normalized)
    ? parentAndName(normalized).destination
    : normalized;
  const userMatch = scopedPath.match(/^\/users\/[^/]+(\/.*)?$/);
  if (userMatch) {
    const relative = userMatch[1] ?? "";
    return relative ? `My Drive${relative}` : "My Drive";
  }
  const groupMatch = normalized.match(/^\/groups\/(.+)$/);
  if (groupMatch) {
    return `Groups/${groupMatch[1]}`;
  }
  return "My Drive";
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
  const folderPath = shareFolderUiPath(normalized);
  if (folderPath === "My Drive") {
    return { to: "/drive", search: {} };
  }
  return { to: "/drive", search: { view: "folder", path: folderPath } };
}

/** Resolve how a public share should open after the guest session is established. */
export function shareDestination(apiPath: string): ShareDestination {
  const normalized = normalizeSharePath(apiPath);
  if (isMarkdownSharePath(normalized)) {
    return { kind: "route", route: shareDestinationRoute(normalized) };
  }
  if (isShareTargetFile(normalized) && shareFileShouldDownload(normalized)) {
    return { kind: "download", apiPath: normalized };
  }
  return { kind: "route", route: shareDestinationRoute(normalized) };
}

/** Route guests to Docs for markdown shares; otherwise open Drive at the share folder. */
export function shareDestinationHref(apiPath: string): string {
  const destination = shareDestination(apiPath);
  if (destination.kind === "download") {
    return "/share";
  }
  const route = destination.route;
  const params = new URLSearchParams(route.search);
  const qs = params.toString();
  return `${route.to}${qs ? `?${qs}` : ""}`;
}
