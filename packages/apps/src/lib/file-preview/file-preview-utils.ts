import { markdownToPlainText } from "@/lib/models/note-body-markdown";
import { extensionFromFileName } from "@/drive-core/src/drive-file-utils";
import type { FileKind } from "@/drive-core/src/drive-models";
import { DOCS_EDITOR_EXTENSIONS } from "@/drive-core/src/drive-models";
import type { FilePreviewPayload } from "@/lib/file-preview/file-preview-types";

/** Extensions always treated as inline text previews (tier 1 allowlist). */
export const TEXT_PREVIEW_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "yaml",
  "yml",
  "csv",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "sh",
  "bash",
  "zsh",
  "sql",
  "toml",
  "ini",
  "env",
  "log",
]);

/** Binary document formats excluded from inline text render. */
export const BINARY_DOC_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
]);

export const TILE_TEXT_FETCH_BYTES = 4096;
export const TILE_TEXT_PREVIEW_MAX_CHARS = 600;
/** Max blob size loaded into the read-only Docs editor preview surface. */
export const DOCS_PREVIEW_MAX_BYTES = 512 * 1024;

export function isTextPreviewExtension(extension: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(extension.toLowerCase());
}

export function isBinaryDocExtension(extension: string): boolean {
  return BINARY_DOC_EXTENSIONS.has(extension.toLowerCase());
}

/** Whether indexed/search excerpt is displayable body text (not a storage path). */
export function isUsableTextExcerpt(excerpt: string, apiPath?: string): boolean {
  const trimmed = excerpt.trim();
  if (!trimmed) return false;
  const normalizedPath = apiPath?.replace(/^\/+/, "") ?? "";
  if (normalizedPath && trimmed.replace(/^\/+/, "") === normalizedPath) return false;
  if (trimmed.startsWith("/") && !/\s/.test(trimmed)) return false;
  return true;
}

/** True when the first bytes look like UTF-8 text (no NULs in the sniff window). */
export function isLikelyUtf8Text(bytes: Uint8Array, maxBytes = 512): boolean {
  const limit = Math.min(bytes.length, maxBytes);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) return false;
  }
  return limit > 0;
}

export function decodeUtf8Preview(bytes: Uint8Array): string | null {
  if (!isLikelyUtf8Text(bytes)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function stripPreviewText(raw: string, fileName: string): string {
  const ext = extensionFromFileName(fileName);
  if (ext === "md" || ext === "markdown") {
    return markdownToPlainText(raw);
  }
  return raw.replace(/\r\n/g, "\n").trim();
}

export function truncatePreviewText(text: string, maxChars = TILE_TEXT_PREVIEW_MAX_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

export function formatPreviewText(raw: string, fileName: string, maxChars?: number): string {
  const stripped = stripPreviewText(raw, fileName);
  if (maxChars === undefined) return stripped;
  return truncatePreviewText(stripped, maxChars);
}

export function docsEditorExtensionFromFileName(fileName: string, apiPath?: string): string {
  let ext = extensionFromFileName(fileName);
  if (!ext && apiPath) {
    ext = extensionFromFileName(apiPath.split("/").pop() ?? "");
  }
  return ext.toLowerCase();
}

export function isDocsEditorPreviewFile(fileName: string, apiPath?: string): boolean {
  return DOCS_EDITOR_EXTENSIONS.has(docsEditorExtensionFromFileName(fileName, apiPath));
}

export function decodeDocsPreviewContent(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "";
  const decoded = decodeUtf8Preview(bytes);
  if (!decoded) return null;
  return decoded.replace(/\r\n/g, "\n");
}

export function mediaAspectRatio(width?: number, height?: number): number | null {
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  return width / height;
}

function readImageBlobDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function readVideoBlobDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = url;
  });
}

/** Decode intrinsic media dimensions from a fetched blob (grid prefetch). */
export async function readBlobMediaDimensions(
  blob: Blob,
  fileKind: Extract<FileKind, "image" | "video">,
): Promise<{ width: number; height: number } | null> {
  if (fileKind === "video" || blob.type.startsWith("video/")) {
    return readVideoBlobDimensions(blob);
  }
  return readImageBlobDimensions(blob);
}

export function resolveDetailFilePreview(
  filePreviews: Record<string, FilePreviewPayload>,
  richPreviews: Record<string, FilePreviewPayload>,
  fileId: string,
): FilePreviewPayload | undefined {
  return richPreviews[fileId] ?? filePreviews[fileId];
}

/**
 * Grid tiles only show media (image/video) thumbnails.
 * Text and markdown body previews fall back to the kind icon.
 */
export function resolveGridFilePreview(
  filePreviews: Record<string, FilePreviewPayload>,
  richPreviews: Record<string, FilePreviewPayload>,
  fileId: string,
): FilePreviewPayload | undefined {
  const preview = resolveDetailFilePreview(filePreviews, richPreviews, fileId);
  if (preview?.kind === "blob-url") return preview;
  return undefined;
}

export function fileSupportsTextPreview(fileName: string, kind: string, apiPath?: string): boolean {
  let ext = extensionFromFileName(fileName);
  if (!ext && apiPath) {
    ext = extensionFromFileName(apiPath.split("/").pop() ?? "");
  }
  if (isBinaryDocExtension(ext)) return false;
  if (isTextPreviewExtension(ext)) return true;
  if (kind === "doc" && (!ext || !isBinaryDocExtension(ext))) return true;
  return false;
}
