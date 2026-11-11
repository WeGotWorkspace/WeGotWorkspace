import type { DriveFile, FileKind } from "@/lib/files/drive-models";
import type { DriveUnifiedSearchResult } from "@/lib/files/drive-types";
import { uiPathFromApiPath } from "@/lib/files/drive-path-utils";
import { driveLocationLabel, driveShareFlagsFromListing } from "@/drive-core/src/drive-file-utils";
import { formatBytesCompact } from "@/lib/files/file-name-utils";

export { driveLocationLabel } from "@/drive-core/src/drive-file-utils";

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
  viewerUsername?: string,
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
    ...(typeof result.modifiedAt === "number" && result.modifiedAt > 0
      ? { modifiedMs: result.modifiedAt * 1000 }
      : {}),
    ...(kind === "folder" ? {} : { sizeBytes: Math.max(0, result.size) }),
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
    ...(result.nodeId ? { nodeId: result.nodeId } : {}),
    location: driveLocationLabel(result.sourceKey, viewerUsername) ?? undefined,
    ...driveShareFlagsFromListing({
      hasShares: result.metadata?.hasShares === true,
      hasPublicShare: result.metadata?.hasPublicShare === true,
      hasTeamShare: result.metadata?.hasTeamShare === true,
    }),
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
