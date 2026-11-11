import type { DriveFile, FileKind } from "@/lib/files/drive-models";

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

/** Bytes from a listed size such as "1.5 MB"; `null` for folders or an unreadable size. */
export function parseFileSizeBytes(file: Pick<DriveFile, "kind" | "size">): number | null {
  if (file.kind === "folder") return null;
  const raw = file.size?.replace(/[^\d.]/g, "");
  if (!raw) return 0;
  const kb = Number.parseFloat(raw);
  if (Number.isNaN(kb)) return null;
  if (file.size?.includes("MB")) return Math.round(kb * 1024 * 1024);
  if (file.size?.includes("GB")) return Math.round(kb * 1024 * 1024 * 1024);
  if (file.size?.includes("KB")) return Math.round(kb * 1024);
  return Math.round(kb);
}
