import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import type { DriveUnifiedSearchResult } from "@/drive-core/src/drive-types";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";
import { formatBytesCompact } from "@/drive-core/src/drive-file-utils";

export function parentVirtualPath(path: string): string {
  const normalized = path.trim().replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "My Drive";
  return normalized.slice(0, idx);
}

export function apiPathFromSearchSourceKey(sourceKey: string): string | null {
  const key = sourceKey.trim().replace(/^\/+/, "");
  if (!key) return null;
  return `/${key}`;
}

/**
 * Top-level drive location label for a unified-search source key.
 * `users/...` → `My Drive`; `groups/{name}/...` → `{name}` (matches sidebar drive labels).
 */
export function driveLocationLabel(sourceKey: string): string | null {
  const segments = sourceKey.split("/").filter(Boolean);
  if (segments[0] === "users") return "My Drive";
  if (segments[0] === "groups" && segments[1]) return segments[1];
  return null;
}

/** Whether a file's API path lives under a shared (group) drive. */
export function isSharedDriveApiPath(apiPath: string | undefined): boolean {
  const normalized = apiPath?.trim().replace(/^\/+/, "") ?? "";
  return normalized.startsWith("groups/");
}

function fileKindFromCategory(category: string | null | undefined): FileKind {
  if (category === "folder") return "folder";
  if (category === "image") return "image";
  if (category === "audio") return "audio";
  if (category === "video") return "video";
  if (category === "archive") return "archive";
  if (category === "document" || category === "spreadsheet" || category === "presentation") {
    return "doc";
  }
  if (category === "doc") return "doc";
  return "file";
}

export function driveFileFromSearchResult(
  result: DriveUnifiedSearchResult,
  uiPath: string,
  apiPath: string,
): DriveFile {
  const title = result.title || uiPath.split("/").pop() || result.sourceKey;
  const parent = parentVirtualPath(uiPath);
  const kind = fileKindFromCategory(result.category);
  const date =
    typeof result.modifiedAt === "number" && result.modifiedAt > 0
      ? new Date(result.modifiedAt * 1000).toLocaleDateString()
      : "Now";

  return {
    id: `search:${result.sourceType}:${result.sourceKey}`,
    category: result.category ?? "File",
    date,
    title,
    excerpt: result.snippet ?? "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent,
    kind,
    size: result.size > 0 ? formatBytesCompact(result.size) : "—",
    apiPath: apiPath || undefined,
    location: driveLocationLabel(result.sourceKey) ?? undefined,
    ...(result.metadata?.hasShares === true ? { isShared: true } : {}),
  };
}

export function uiPathForSearchResult(
  result: DriveUnifiedSearchResult,
  username: string,
): string | null {
  const apiPath = apiPathFromSearchSourceKey(result.sourceKey);
  if (!apiPath) return null;
  return uiPathFromApiPath(apiPath, username);
}
