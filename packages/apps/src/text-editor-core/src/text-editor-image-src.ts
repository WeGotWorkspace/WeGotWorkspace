import { isFileNodeId } from "@/lib/files/file-node-id";

/** Stable FileNode reference stored in Docs markdown / Yjs — never bytes or `fnb-` blob ids. */
export const DRIVE_FN_SRC_PREFIX = "drive:";

const DRIVE_FN_SRC_PATTERN = /^drive:(fn-[0-9a-f]{32})$/i;

export { isFileNodeId };

export function toDriveFnSrc(nodeId: string): string {
  const trimmed = nodeId.trim();
  const fromSrc = trimmed.match(DRIVE_FN_SRC_PATTERN);
  const id = fromSrc ? fromSrc[1] : trimmed;
  if (!isFileNodeId(id)) {
    throw new Error(`Expected a FileNode id (fn-…), got "${nodeId}".`);
  }
  return `${DRIVE_FN_SRC_PREFIX}${id.toLowerCase()}`;
}

export function parseDriveFnSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const match = src.trim().match(DRIVE_FN_SRC_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

export function isHttpImageSrc(src: string): boolean {
  return src.startsWith("https://") || src.startsWith("http://");
}

/**
 * Persistable `src` for markdown / HTML / Yjs. Drops `blob:` and `data:` so
 * track-changes export and collab never embed image bytes.
 */
export function serializeDocsImageSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  const driveFn = parseDriveFnSrc(trimmed);
  if (driveFn) return toDriveFnSrc(driveFn);
  if (isHttpImageSrc(trimmed)) return trimmed;
  return null;
}

export function docsImageMarkdown(alt: string, src: string | null | undefined): string {
  const serialized = serializeDocsImageSrc(src) ?? "";
  return `![${alt}](${serialized})`;
}
