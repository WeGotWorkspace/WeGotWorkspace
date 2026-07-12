import { parentAndName, pathFromDirectoryEntry } from "@/lib/files/api-path";
import type { DriveUIData } from "@/drive-core/src/drive-types";
import type { DriveFile, FileKind } from "@/drive-core/src/drive-models";
import { uiPathFromApiPath } from "@/drive-core/src/drive-path-utils";

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
    ...(entry.hasShares === true ? { isShared: true } : {}),
  };
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
