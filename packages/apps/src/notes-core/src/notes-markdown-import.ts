import { isValidNewTag, normalizeTag } from "@/notes-core/src/note-tag";
import { splitFrontMatter } from "@/notes-core/src/notes-markdown-front-matter";

/**
 * Markdown file → note fields for the Notes import (#1623). Pure: no network.
 * The orchestrator (`notes-markdown-import-run.ts`) uploads the extracted
 * images and writes the note.
 */

export const MARKDOWN_IMPORT_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";

/** Same cap as the API (`NoteJournalConverter::MAX_MARKDOWN_BYTES`). */
export const NOTE_BODY_MAX_BYTES = 2 * 1024 * 1024;

/** Raw file cap before decoding: base64 images may make a file larger than its body. */
export const MARKDOWN_IMPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** API `NoteCreateRequest`: `title` max 1024. */
export const NOTE_TITLE_MAX_LENGTH = 1024;

const MARKDOWN_FILE_NAME = /\.(?:md|markdown|txt)$/i;

/** NUL never occurs in an accepted file ({@link decodeMarkdownBytes}), so it marks images safely. */
const PLACEHOLDER_MARK = "\u0000";

/** Length of `drive:fn-<32 hex>` — what each uploaded image becomes in the body. */
const DRIVE_FN_SRC_SAMPLE = `drive:fn-${"0".repeat(32)}`;

export type MarkdownImportSkipReason =
  "unsupportedType" | "tooLarge" | "notUtf8" | "empty" | "bodyTooLarge" | "failed";

export type MarkdownImportImage = {
  alt: string;
  /** `image/png` etc.; null when the data URL is not base64 image data. */
  mimeType: string | null;
  base64: string | null;
};

export type ParsedMarkdownNote = {
  title: string;
  tags: string[];
  droppedTags: string[];
  /** Body with one placeholder per entry of `images`; finish with {@link finalizeImportedBody}. */
  body: string;
  images: MarkdownImportImage[];
  /** Relative-path images left as text in the body. */
  relativeImageCount: number;
};

export function isMarkdownImportFile(file: Pick<File, "name">): boolean {
  return MARKDOWN_FILE_NAME.test(file.name);
}

export function fileNameTitle(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  return (withoutExtension || base).trim();
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function cutTitle(title: string): string {
  const chars = Array.from(title.trim());
  return chars.length > NOTE_TITLE_MAX_LENGTH
    ? chars.slice(0, NOTE_TITLE_MAX_LENGTH).join("").trim()
    : title.trim();
}

/** Decode bytes as strict UTF-8. Null for invalid UTF-8 or binary (NUL) content. */
export function decodeMarkdownBytes(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.includes(PLACEHOLDER_MARK)) return null;
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export type MarkdownImportText =
  { ok: true; text: string } | { ok: false; reason: MarkdownImportSkipReason };

async function fileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Uint8Array(await new Response(file).arrayBuffer());
}

export async function readMarkdownImportText(file: File): Promise<MarkdownImportText> {
  if (!isMarkdownImportFile(file)) return { ok: false, reason: "unsupportedType" };
  if (file.size > MARKDOWN_IMPORT_MAX_FILE_BYTES) return { ok: false, reason: "tooLarge" };
  const text = decodeMarkdownBytes(await fileBytes(file));
  if (text === null) return { ok: false, reason: "notUtf8" };
  if (text.trim() === "") return { ok: false, reason: "empty" };
  return { ok: true, text };
}

function splitTags(rawTags: readonly string[]): { tags: string[]; droppedTags: string[] } {
  const tags: string[] = [];
  const droppedTags: string[] = [];
  for (const raw of rawTags) {
    if (isValidNewTag(raw)) {
      const tag = normalizeTag(raw);
      if (!tags.includes(tag)) tags.push(tag);
    } else if (!droppedTags.includes(raw)) {
      droppedTags.push(raw);
    }
  }
  return { tags, droppedTags };
}

const ATX_H1 = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/;

/** First non-blank line as a level-1 ATX heading → title, removed from the body. */
function takeH1Title(body: string): { title: string; body: string } | null {
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index < 0) return null;
  const match = lines[index].match(ATX_H1);
  if (!match || !match[1].trim()) return null;
  return { title: match[1].trim(), body: lines.slice(index + 1).join("\n") };
}

/** `![alt](dest "title")`; alt may hold one level of balanced brackets. */
const INLINE_IMAGE =
  /!\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_PATH = /^[a-z]:[\\/]/i;
const DATA_IMAGE_BASE64 =
  /^data:(image\/[a-z0-9.+-]+)(?:;[a-z0-9=._-]+)*;base64,([a-z0-9+/=\s]*)$/i;

function imageDestination(raw: string): string {
  return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1).trim() : raw.trim();
}

export function isRelativeImageSource(src: string): boolean {
  if (!src || src.startsWith("#") || src.startsWith("//")) return false;
  if (WINDOWS_PATH.test(src)) return true;
  if (/^file:/i.test(src)) return true;
  return !URL_SCHEME.test(src);
}

function imagePlaceholder(index: number): string {
  return `${PLACEHOLDER_MARK}${index}${PLACEHOLDER_MARK}`;
}

/** Swap images outside fenced code blocks; count relative ones. */
function extractImages(body: string): {
  body: string;
  images: MarkdownImportImage[];
  relativeImageCount: number;
} {
  const images: MarkdownImportImage[] = [];
  let relativeImageCount = 0;
  const replaceImages = (segment: string) =>
    segment.replace(INLINE_IMAGE, (whole, alt: string, rawDestination: string) => {
      const src = imageDestination(rawDestination);
      if (/^data:/i.test(src)) {
        const data = src.match(DATA_IMAGE_BASE64);
        images.push({
          alt: alt.trim(),
          mimeType: data ? data[1].toLowerCase() : null,
          base64: data ? data[2].replace(/\s+/g, "") : null,
        });
        return imagePlaceholder(images.length - 1);
      }
      if (isRelativeImageSource(src)) relativeImageCount += 1;
      return whole;
    });

  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flushProse = () => {
    if (prose.length > 0) out.push(replaceImages(prose.join("\n")));
    prose = [];
  };
  for (const line of body.split("\n")) {
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      flushProse();
      fence = marker;
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return { body: out.join("\n"), images, relativeImageCount };
}

export function parseMarkdownNote(text: string, fileName: string): ParsedMarkdownNote {
  const { frontMatter, body: afterFrontMatter } = splitFrontMatter(text);
  let body = afterFrontMatter;
  let title = frontMatter?.title?.trim() ?? "";
  if (!title) {
    const h1 = takeH1Title(body);
    if (h1) {
      title = h1.title;
      body = h1.body;
    }
  }
  if (!title) title = fileNameTitle(fileName);
  body = body.replace(LEADING_BLANK_LINES, "").trimEnd();
  const { tags, droppedTags } = splitTags(frontMatter?.tags ?? []);
  const extracted = extractImages(body);
  return {
    title: cutTitle(title),
    tags,
    droppedTags,
    body: extracted.body,
    images: extracted.images,
    relativeImageCount: extracted.relativeImageCount,
  };
}

function escapeImageAlt(alt: string): string {
  return alt.replace(/[[\]\\]/g, (char) => `\\${char}`);
}

/**
 * Replace each image placeholder: a `drive:` source becomes `![alt](src)`;
 * `null` (not imported) leaves the alt text.
 */
export function finalizeImportedBody(
  parsed: Pick<ParsedMarkdownNote, "body" | "images">,
  sources: ReadonlyArray<string | null>,
): string {
  // Odd parts sit between two marks: the image index.
  return parsed.body
    .split(PLACEHOLDER_MARK)
    .map((part, position) => {
      if (position % 2 === 0) return part;
      const index = Number(part);
      const alt = parsed.images[index]?.alt ?? "";
      const src = sources[index];
      return src ? `![${escapeImageAlt(alt)}](${src})` : alt;
    })
    .join("");
}

/** Body bytes once every image is a `drive:fn-…` reference — checked before anything is written. */
export function importedBodyByteLength(
  parsed: Pick<ParsedMarkdownNote, "body" | "images">,
): number {
  return utf8ByteLength(
    finalizeImportedBody(
      parsed,
      parsed.images.map(() => DRIVE_FN_SRC_SAMPLE),
    ),
  );
}

/** Decode a parsed image into a File for upload; null when it is not base64 image data. */
export function markdownImageFile(image: MarkdownImportImage, index: number): File | null {
  if (!image.mimeType || !image.base64) return null;
  let binary: string;
  try {
    binary = atob(image.base64);
  } catch {
    return null;
  }
  if (binary.length === 0) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const subtype = image.mimeType.slice("image/".length).replace("+xml", "");
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  return new File([bytes], `image-${index + 1}.${extension}`, { type: image.mimeType });
}
