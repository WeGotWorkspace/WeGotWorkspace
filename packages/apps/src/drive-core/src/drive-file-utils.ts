import { parentAndName, pathFromDirectoryEntry } from "@/lib/files/api-path";
import type { DriveUIData } from "@/drive-core/src/drive-types";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import {
  normalizeApiVirtualPath,
  SHARED_WITH_ME_UI_ROOT,
  uiPathFromApiPath,
} from "@/drive-core/src/drive-path-utils";

const BROWSER_PREVIEW_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

/** Extensions the browser can usually render in `<img>` (excludes HEIC/HEIF/TIFF, etc.). */
export function canBrowserPreviewImage(fileName: string): boolean {
  return BROWSER_PREVIEW_IMAGE_EXT.test(fileName.toLowerCase());
}

export function inferFileKindFromName(name: string): FileKind {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i.test(lower)) return "image";
  if (/\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(lower)) return "audio";
  if (/\.(zip|tar|gz|bz2|xz|rar|7z)$/i.test(lower)) return "archive";
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|md|markdown)$/i.test(lower)) return "doc";
  return "file";
}

export function extensionFromFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(".")) return "";
  return (trimmed.split(".").pop() ?? "").toLowerCase();
}

export function formatBytesCompact(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

type DriveShareListingFlags = {
  hasShares?: boolean;
  hasPublicShare?: boolean;
  hasTeamShare?: boolean;
};

/** Map directory/search listing share flags onto `DriveFile` fields. */
export function driveShareFlagsFromListing(
  source: DriveShareListingFlags,
): Pick<DriveFile, "isShared" | "hasPublicShare" | "hasTeamShare"> {
  const hasPublicShare = source.hasPublicShare === true;
  const hasTeamShare = source.hasTeamShare === true;
  const isShared = source.hasShares === true || hasPublicShare || hasTeamShare;
  return {
    ...(hasPublicShare ? { hasPublicShare: true } : {}),
    ...(hasTeamShare ? { hasTeamShare: true } : {}),
    ...(isShared ? { isShared: true } : {}),
  };
}

export function driveFileFromEntry(
  entry: DriveUIData["directory"]["files"][number],
  username: string,
): DriveFile {
  const apiPath = pathFromDirectoryEntry(entry);
  const parentApiPath = parentAndName(apiPath).destination;
  const parent = uiPathFromApiPath(parentApiPath, username);
  const kind: FileKind = entry.type === "dir" ? "folder" : inferFileKindFromName(entry.name);
  const date = entry.time > 0 ? new Date(entry.time * 1000).toLocaleDateString() : "Now";
  const size = entry.type === "dir" ? "—" : entry.size > 0 ? formatBytesCompact(entry.size) : "0 B";
  return {
    id: apiPath,
    notebook: entry.type === "dir" ? "Folder" : `File · ${size}`,
    category: entry.type === "dir" ? "Folder" : "File",
    date,
    title: entry.name,
    excerpt: entry.path,
    body: [],
    tags: [],
    wordCount: 0,
    parent,
    kind,
    size,
    apiPath,
    mayShare: entry.myRights?.mayShare,
    mayManageStructure: entry.myRights?.mayManageStructure,
    ...driveShareFlagsFromListing(entry),
  };
}

/**
 * Owner username for a personal-drive share path (`/users/{owner}/…`).
 * Returns null for group paths or malformed keys.
 */
export function shareOwnerUsernameFromApiPath(apiPath: string): string | null {
  const segments = normalizeApiVirtualPath(apiPath).split("/").filter(Boolean);
  if (segments[0] !== "users" || !segments[1]) return null;
  return segments[1];
}

/**
 * Prefer an explicit share owner when the API provides it; otherwise derive from `/users/{owner}/…`.
 */
export function shareOwnerUsernameFromShare(share: {
  path: string;
  ownerUsername?: string | null;
}): string | null {
  const explicit = share.ownerUsername?.trim();
  if (explicit) return explicit;
  return shareOwnerUsernameFromApiPath(share.path);
}

/** Location + share indicator for Shared with me rows (Share2, not team/Users). */
function sharedWithMeListingFields(
  ownerUsername: string | null,
): Pick<DriveFile, "location" | "isShared"> {
  return {
    location: ownerUsername ? driveLabels.sharedBy(ownerUsername) : driveLabels.sidebarSharedWithMe,
    ...driveShareFlagsFromListing({ hasShares: true }),
  };
}

/** Map a resolved directory entry into the Shared with me virtual root. */
export function driveFileForSharedWithMeListing(
  entry: DriveUIData["directory"]["files"][number],
  username: string,
  ownerUsername?: string | null,
): DriveFile {
  const owner =
    ownerUsername?.trim() || shareOwnerUsernameFromApiPath(pathFromDirectoryEntry(entry));
  return {
    ...driveFileFromEntry(entry, username),
    parent: SHARED_WITH_ME_UI_ROOT,
    ...sharedWithMeListingFields(owner),
  };
}

/**
 * Build a Shared with me row from a `shared-with-me` API item.
 * Prefer the resolved `entry` (grantees often cannot list the parent directory).
 */
export function driveFileFromSharedWithMeEntry(
  item: {
    share: {
      path: string;
      ownerUsername?: string | null;
      myRights?: DriveUIData["directory"]["files"][number]["myRights"];
      updatedAt?: string | null;
    };
    entry?: DriveUIData["directory"]["files"][number] | null;
  },
  username: string,
): DriveFile | null {
  const owner = shareOwnerUsernameFromShare(item.share);

  if (item.entry) {
    return driveFileForSharedWithMeListing(item.entry, username, owner);
  }

  const apiPath = item.share.path.trim();
  if (!apiPath || apiPath === "/") return null;

  const name = apiPath.includes("/") ? (apiPath.split("/").pop() ?? apiPath) : apiPath;
  const updatedMs = item.share.updatedAt ? Date.parse(item.share.updatedAt) : Number.NaN;
  const time = Number.isFinite(updatedMs) ? Math.floor(updatedMs / 1000) : 0;

  return driveFileForSharedWithMeListing(
    {
      type: "file",
      path: apiPath,
      name,
      size: 0,
      time,
      permissions: 0,
      myRights: item.share.myRights ?? {
        mayView: true,
        mayComment: false,
        mayReview: false,
        mayEditContent: false,
        mayManageStructure: false,
        mayShare: false,
      },
    },
    username,
    owner,
  );
}

/** Pick a unique `Untitled.md` name against existing file titles in the current listing. */
export function suggestNewMarkdownFileName(files: readonly DriveFile[]): string {
  const taken = new Set(
    files.filter((file) => file.kind !== "folder").map((file) => file.title.trim().toLowerCase()),
  );
  const base = "Untitled";
  let candidate = `${base}.md`;
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} ${index}.md`;
    index += 1;
  }
  return candidate;
}
