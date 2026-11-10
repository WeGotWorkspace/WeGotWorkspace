import { Inflate, strFromU8 } from "fflate";
import { splitElements } from "@/docs-core/src/docx-import/docx-alternate-content";

/**
 * Why a file cannot be converted. Checked before anything is written (#1619).
 * - `ole-container`: an old binary `.doc` or a password-protected `.docx`
 *   (Word encrypts into an OLE compound file, so both start with D0 CF 11 E0).
 * - `not-a-zip`: some other file renamed to `.docx`.
 * - `corrupt-zip`: starts like a zip but cannot be unpacked.
 * - `not-a-docx`: a zip without `word/document.xml`.
 * - `too-large`: unpacks to more than {@link DOCX_MAX_UNPACKED_BYTES} (a zip bomb,
 *   or simply too much for the browser).
 */
export type DocxRefusal =
  "ole-container" | "not-a-zip" | "corrupt-zip" | "not-a-docx" | "too-large";

/** Sum of the bytes every part really inflates to (never the declared sizes). mammoth inflates them all. */
export const DOCX_MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

/** What the converter drops or changes; each count feeds one import report line. */
export type DocxScanCounts = {
  comments: number;
  trackedChanges: number;
  headersAndFooters: number;
  footnotes: number;
  endnotes: number;
  /** Text boxes whose text is lost (Word only stored the modern form). */
  textBoxes: number;
  /** Text boxes whose text comes across as plain paragraphs, without the box. */
  textBoxesAsText: number;
  /** Centred, right or justified paragraphs: a Doc's Markdown cannot store alignment. */
  alignment: number;
  /** "Page break before" paragraph settings. Plain page breaks become Doc page breaks. */
  pageBreaks: number;
  sections: number;
  fonts: number;
  colours: number;
  embeddedObjects: number;
};

export type DocxScan = { ok: false; refusal: DocxRefusal } | { ok: true; counts: DocxScanCounts };

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
const ZIP_MAGIC = [0x50, 0x4b];
const TEXT_BOX = /<w:txbxContent[\s>]/g;
const NOTE_SEPARATOR_TYPES = /w:type="(separator|continuationSeparator|continuationNotice)"/;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

function count(xml: string, pattern: RegExp): number {
  return xml.match(pattern)?.length ?? 0;
}

/** The visible text of a header, footer or note part, to skip empty ones. */
function textOf(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>[^<]*/g) ?? [])
    .map((run) => run.replace(/^<w:t[^>]*>/, ""))
    .join("")
    .trim();
}

function countNotes(xml: string | undefined, tag: "footnote" | "endnote"): number {
  if (!xml) return 0;
  const notes = xml.match(new RegExp(`<w:${tag}\\s[^>]*>`, "g")) ?? [];
  return notes.filter((open) => !NOTE_SEPARATOR_TYPES.test(open)).length;
}

const ALIGNED = /<w:jc\s+w:val="(?:center|right|end|both|distribute)"/;

/** Paragraph properties with a non-left alignment. A linear walk: no regex backtracking. */
function countAlignedParagraphs(xml: string): number {
  let aligned = 0;
  let from = 0;
  for (;;) {
    const open = xml.indexOf("<w:pPr>", from);
    if (open < 0) return aligned;
    const close = xml.indexOf("</w:pPr>", open);
    if (close < 0) return aligned;
    if (ALIGNED.test(xml.slice(open, close))) aligned += 1;
    from = close;
  }
}

function distinct(values: Iterable<string>): number {
  return new Set(values).size;
}

/**
 * Only the parts the report reads are kept: a .docx with large images then
 * costs no more memory here than the XML it carries. Every part is still inflated
 * and counted against the cap.
 */
function isScannedPart(name: string): boolean {
  return /^word\/(document|comments|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name);
}

const TOO_LARGE = Symbol("too-large");
const SLICE_BYTES = 8 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Reads the entries the way mammoth's JSZip does: from the central directory
 * (method, compressed size, local header offset), never from the local headers, so
 * what is counted is what gets inflated. Inflates every entry in 8 KiB slices (a
 * deflate stream expands about 1032:1 at most) and throws {@link TOO_LARGE} as soon as
 * the real output passes the cap. Only the parts the report reads are kept.
 */
function unpackCounting(bytes: Uint8Array, maxUnpackedBytes: number): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const corrupt = () => new Error("corrupt zip");
  const u16 = (at: number) => (at + 2 <= bytes.length ? view.getUint16(at, true) : -1);
  const u32 = (at: number) => (at + 4 <= bytes.length ? view.getUint32(at, true) : -1);

  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (u32(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw corrupt();
  // Any all-ones field makes JSZip follow a zip64 record this walk does not read.
  for (const at of [4, 6, 8, 10]) if (u16(eocd + at) === 0xffff) throw corrupt();
  const centralSize = u32(eocd + 12);
  const entryCount = u16(eocd + 10);
  let cursor = u32(eocd + 16);
  if (cursor < 0 || centralSize < 0 || cursor === 0xffffffff || centralSize === 0xffffffff) {
    throw corrupt();
  }
  // JSZip shifts every offset by any gap between the directory and the end record.
  if (eocd !== cursor + centralSize) throw corrupt();

  const kept: Record<string, Uint8Array[]> = {};
  let unpackedBytes = 0;
  let entries = 0;
  // Like JSZip: read records for as long as the signature matches, whatever the count says.
  while (u32(cursor) === CENTRAL_SIGNATURE) {
    entries += 1;
    const method = u16(cursor + 10);
    const compressedSize = u32(cursor + 20);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const localOffset = u32(cursor + 42);
    if (compressedSize < 0 || localOffset < 0 || nameLength < 0) throw corrupt();
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw corrupt();
    cursor += 46 + nameLength + extraLength + commentLength;

    // Every entry counts, folders included (a real folder has no data). JSZip names an
    // entry by its local header, so that name decides which parts are kept.
    if (method !== 0 && method !== 8) throw corrupt();
    if (u32(localOffset) !== LOCAL_SIGNATURE) throw corrupt();
    const localNameLength = u16(localOffset + 26);
    const start = localOffset + 30 + localNameLength + u16(localOffset + 28);
    const end = start + compressedSize;
    if (end > bytes.length) throw corrupt();
    const name = strFromU8(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));

    const chunks: Uint8Array[] | null = isScannedPart(name) ? [] : null;
    if (chunks) kept[name] = chunks;
    const onChunk = (chunk: Uint8Array) => {
      unpackedBytes += chunk.length;
      if (unpackedBytes > maxUnpackedBytes) throw TOO_LARGE;
      chunks?.push(chunk);
    };
    if (method === 0) {
      for (let at = start; at < end; at += SLICE_BYTES) {
        onChunk(bytes.subarray(at, Math.min(end, at + SLICE_BYTES)));
      }
    } else if (compressedSize > 0) {
      const inflate = new Inflate((chunk) => onChunk(chunk));
      for (let at = start; at < end; at += SLICE_BYTES) {
        const next = Math.min(end, at + SLICE_BYTES);
        inflate.push(bytes.subarray(at, next), next === end);
      }
    }
  }
  if (entries !== entryCount || cursor !== eocd) throw corrupt();
  const parts: Record<string, Uint8Array> = {};
  for (const [name, chunks] of Object.entries(kept)) {
    const whole = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      whole.set(chunk, offset);
      offset += chunk.length;
    }
    parts[name] = whole;
  }
  return parts;
}

export function scanDocx(
  bytes: Uint8Array,
  maxUnpackedBytes: number = DOCX_MAX_UNPACKED_BYTES,
): DocxScan {
  if (startsWith(bytes, OLE_MAGIC)) return { ok: false, refusal: "ole-container" };
  if (!startsWith(bytes, ZIP_MAGIC)) return { ok: false, refusal: "not-a-zip" };

  let parts: Record<string, Uint8Array>;
  try {
    parts = unpackCounting(bytes, maxUnpackedBytes);
  } catch (error) {
    if (error === TOO_LARGE) return { ok: false, refusal: "too-large" };
    return { ok: false, refusal: "corrupt-zip" };
  }
  const documentXml = parts["word/document.xml"];
  if (!documentXml) return { ok: false, refusal: "not-a-docx" };

  // Count every shape once: skip the fallback copies Word and LibreOffice add.
  const { inside: fallbacks, outside: body } = splitElements(strFromU8(documentXml), "mc:Fallback");
  const textBoxes = count(body, TEXT_BOX);
  const textBoxesAsText = Math.min(
    textBoxes,
    count(fallbacks, TEXT_BOX) + count(splitElements(body, "mc:Choice").outside, TEXT_BOX),
  );
  const xmlOf = (name: string) => (parts[name] ? strFromU8(parts[name]) : undefined);
  const matching = (pattern: RegExp) =>
    Object.keys(parts)
      .filter((name) => pattern.test(name))
      .map((name) => strFromU8(parts[name]));

  // LibreOffice writes first, even and default variants of the same text: count texts.
  const headerFooterTexts = matching(/^word\/(header|footer)\d*\.xml$/)
    .map(textOf)
    .filter(Boolean);

  const fonts = (body.match(/<w:rFonts\s[^>]*w:ascii="[^"]+"/g) ?? []).map((tag) =>
    tag.replace(/.*w:ascii="/, "").replace(/"$/, ""),
  );
  const colours = (body.match(/<w:color\s+w:val="[0-9A-Fa-f]{6}"/g) ?? [])
    .map((tag) => tag.slice(-7, -1).toUpperCase())
    .filter((colour) => colour !== "000000");

  return {
    ok: true,
    counts: {
      comments: count(xmlOf("word/comments.xml") ?? "", /<w:comment\s/g),
      trackedChanges:
        count(body, /<w:ins\s/g) +
        count(body, /<w:del\s/g) +
        count(body, /<w:(?:rPr|pPr)Change\s/g),
      headersAndFooters: distinct(headerFooterTexts),
      footnotes: countNotes(xmlOf("word/footnotes.xml"), "footnote"),
      endnotes: countNotes(xmlOf("word/endnotes.xml"), "endnote"),
      textBoxes: textBoxes - textBoxesAsText,
      textBoxesAsText,
      alignment: countAlignedParagraphs(body),
      pageBreaks: count(body, /<w:pageBreakBefore(?:\s+w:val="(?:1|true|on)")?\s*\/>/g),
      // The last sectPr is the document's own page setup; only extra sections are dropped.
      sections: Math.max(0, count(body, /<w:sectPr[\s>]/g) - 1),
      fonts: distinct(fonts),
      colours: distinct(colours),
      embeddedObjects:
        count(body, /<w:object[\s>]/g) +
        count(body, /<w:altChunk\s/g) +
        count(body, /<c:chart\s/g) +
        count(body, /<m:oMath[\s>]/g),
    },
  };
}
