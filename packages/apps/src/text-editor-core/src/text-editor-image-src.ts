import { isFileNodeId } from "@/lib/files/file-node-id";
import {
  normalizeDocsImageAlign,
  normalizeDocsImageWidth,
  type DocsImageAlign,
  type DocsImageLayoutAttrs,
} from "@/text-editor-core/src/text-editor-image-attrs";

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

const WIDTH_KEY = "width";
const ALIGN_KEY = "align";

/**
 * Markdown keeps width and alignment in the URL fragment: `drive:fn-…#width=50&align=end`.
 * A fragment never reaches a server and other renderers ignore it, so the picture still
 * shows. Only our keys are taken out; any other fragment stays on the src.
 */
export function splitImageFragment(raw: string | null | undefined): {
  src: string | null;
  width: number | null;
  align: DocsImageAlign | null;
} {
  if (!raw) return { src: null, width: null, align: null };
  const hash = raw.indexOf("#");
  if (hash < 0) return { src: raw, width: null, align: null };
  const parts = raw.slice(hash + 1).split("&");
  const keyOf = (part: string) => part.split("=")[0];
  const isOurs = (part: string) => keyOf(part) === WIDTH_KEY || keyOf(part) === ALIGN_KEY;
  if (!parts.some(isOurs)) return { src: raw, width: null, align: null };
  const own = new URLSearchParams(parts.filter(isOurs).join("&"));
  const width = normalizeDocsImageWidth(own.get(WIDTH_KEY));
  const align = normalizeDocsImageAlign(own.get(ALIGN_KEY));
  // The rest stays byte for byte; it is never re-encoded.
  const rest = parts.filter((part) => !isOurs(part)).join("&");
  return { src: raw.slice(0, hash) + (rest ? `#${rest}` : ""), width, align };
}

function withImageFragment(src: string, width: number | null, align: DocsImageAlign | null) {
  const { src: base, width: ownWidth, align: ownAlign } = splitImageFragment(src);
  // A fragment that is not ours stays verbatim.
  if (width == null && align == null && ownWidth == null && ownAlign == null) return src;
  const hash = base?.indexOf("#") ?? -1;
  const foreign = base && hash >= 0 ? base.slice(hash + 1) : "";
  const own = new URLSearchParams();
  if (width != null) own.set(WIDTH_KEY, String(width));
  // `start` is the default and stays out of the markdown.
  if (align && align !== "start") own.set(ALIGN_KEY, align);
  const fragment = [foreign, own.toString()].filter(Boolean).join("&");
  const path = base && hash >= 0 ? base.slice(0, hash) : (base ?? "");
  return fragment ? `${path}#${fragment}` : path;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/([\\"])/g, "\\$1");
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * Standard markdown for an image: `![alt](src "caption")`, with width and alignment in the
 * src fragment, and `[…](href)` around it when the picture is a link.
 */
export function docsImageMarkdown(
  alt: string,
  src: string | null | undefined,
  layout?: Partial<DocsImageLayoutAttrs> & { href?: string | null },
): string {
  const serialized = serializeDocsImageSrc(src) ?? "";
  const url = withImageFragment(serialized, layout?.width ?? null, layout?.align ?? null);
  const title = layout?.title ? ` "${escapeMarkdownTitle(layout.title)}"` : "";
  const image = `![${escapeMarkdownText(alt)}](${escapeMarkdownDestination(url)}${title})`;
  return layout?.href ? `[${image}](${escapeMarkdownDestination(layout.href)})` : image;
}
