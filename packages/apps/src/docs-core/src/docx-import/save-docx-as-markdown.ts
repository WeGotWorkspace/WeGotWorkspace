import {
  buildDocxImportReport,
  type DocxImportReport,
} from "@/docs-core/src/docx-import/docx-import-report";
import { markdownNameFor } from "@/docs-core/src/docx-import/docx-file-name";
import { scanDocx, type DocxRefusal } from "@/docs-core/src/docx-import/docx-scan";
import type { DocxConversion } from "@/docs-core/src/docx-import/docx-to-markdown";
import { parentAndName } from "@/lib/files/api-path";
import { toDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

/** Largest Doc the server accepts (`DocCollabDocumentService::MAX_MARKDOWN_BYTES`). */
export const DOC_MAX_MARKDOWN_BYTES = 2_097_152;

/** Largest Word file read into the browser for conversion. */
export const DOCX_MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export type SaveAsMarkdownRefusal = DocxRefusal | "unreadable" | "doc-too-large";

export class DocxSaveRefusedError extends Error {
  constructor(readonly refusal: SaveAsMarkdownRefusal) {
    super(`Save as Markdown refused: ${refusal}`);
    this.name = "DocxSaveRefusedError";
  }
}

/** Drive reads and writes, injected so the order can be tested without a server. */
export type SaveAsMarkdownIo = {
  readSource(apiPath: string): Promise<Uint8Array>;
  /** Creates an empty file, keeping both on a clash. Returns the name and node id it got. */
  createEmptyDoc(parentPath: string, name: string): Promise<{ name: string; nodeId: string }>;
  /** Uploads one image as an attachment of the Doc. Returns its FileNode id. */
  uploadImage(docPath: string, docNodeId: string, image: File): Promise<string>;
  /** Writes onto the created node, by id. */
  writeDoc(docNodeId: string, markdown: string): Promise<void>;
  /** Best-effort cleanup, by id, when the flow fails after creating the Doc. */
  removeDoc(docPath: string, docNodeId: string): Promise<void>;
};

export type SaveAsMarkdownResult = {
  docPath: string;
  report: DocxImportReport;
};

type Convert = (bytes: Uint8Array) => Promise<DocxConversion>;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Removes an image whose upload failed: both its Markdown and HTML-fallback forms. */
function dropImage(markdown: string, placeholder: string): string {
  const id = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown
    .replace(new RegExp(`!\\[(?:\\\\.|[^\\]\\\\])*\\]\\(${id}\\)`, "g"), "")
    .replace(new RegExp(`<img\\b[^>]*\\bsrc="${id}"[^>]*>`, "g"), "");
}

async function uploadImages(
  io: Pick<SaveAsMarkdownIo, "uploadImage">,
  docPath: string,
  docNodeId: string,
  conversion: DocxConversion,
): Promise<{ markdown: string; failed: number }> {
  let { markdown } = conversion;
  let failed = 0;
  for (const [index, image] of conversion.images.entries()) {
    const extension = IMAGE_EXTENSIONS[image.contentType];
    let nodeId: string | null = null;
    if (extension) {
      try {
        const file = new File([image.bytes.slice()], `image-${index + 1}.${extension}`, {
          type: image.contentType,
        });
        nodeId = await io.uploadImage(docPath, docNodeId, file);
      } catch {
        nodeId = null;
      }
    }
    if (nodeId) {
      markdown = markdown.split(image.placeholder).join(toDriveFnSrc(nodeId));
    } else {
      failed += 1;
      markdown = dropImage(markdown, image.placeholder);
    }
  }
  return { markdown, failed };
}

type NewDocTarget = {
  /** The Word file's name, for the report. */
  sourceName: string;
  parentPath: string;
  /** Wanted name; on a clash both are kept and the Doc gets a free name. */
  docName: string;
};

/**
 * Turns Word bytes into a new `.md` Doc. Every refusal is decided before
 * anything is written. Order after that: create the empty Doc, upload images,
 * write the Markdown once.
 */
async function convertDocxIntoNewDoc(
  bytes: Uint8Array,
  target: NewDocTarget,
  io: Omit<SaveAsMarkdownIo, "readSource">,
  convert: Convert,
): Promise<SaveAsMarkdownResult> {
  if (bytes.byteLength > DOCX_MAX_SOURCE_BYTES) throw new DocxSaveRefusedError("too-large");

  const scan = scanDocx(bytes);
  if (!scan.ok) throw new DocxSaveRefusedError(scan.refusal);

  let conversion: DocxConversion;
  try {
    conversion = await convert(bytes);
  } catch {
    throw new DocxSaveRefusedError("unreadable");
  }
  if (utf8Length(conversion.markdown) > DOC_MAX_MARKDOWN_BYTES) {
    throw new DocxSaveRefusedError("doc-too-large");
  }

  const parentPath = target.parentPath.replace(/\/+$/, "");
  const { name, nodeId } = await io.createEmptyDoc(parentPath, target.docName);
  const docPath = `${parentPath}/${name}`;
  try {
    const { markdown, failed } = await uploadImages(io, docPath, nodeId, conversion);
    await io.writeDoc(nodeId, markdown);
    return { docPath, report: buildDocxImportReport(target.sourceName, scan.counts, failed) };
  } catch (error) {
    await io.removeDoc(docPath, nodeId).catch(() => undefined);
    throw error;
  }
}

/** Save as Markdown (#1983): the Word file at `sourcePath` becomes a `.md` next to it. */
export async function saveDocxAsMarkdown(
  sourcePath: string,
  io: SaveAsMarkdownIo,
  convert: Convert,
): Promise<SaveAsMarkdownResult> {
  const { destination: parentPath, from: sourceName } = parentAndName(sourcePath);
  const bytes = await io.readSource(sourcePath);
  return convertDocxIntoNewDoc(
    bytes,
    { sourceName, parentPath, docName: markdownNameFor(sourceName) },
    io,
    convert,
  );
}

/** Import Word file (#1619): a picked file becomes the Doc at `docPath`. */
export async function importDocxFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  docPath: string,
  io: Omit<SaveAsMarkdownIo, "readSource">,
  convert: Convert,
): Promise<SaveAsMarkdownResult> {
  // Refuse before reading a huge file into memory.
  if (file.size > DOCX_MAX_SOURCE_BYTES) throw new DocxSaveRefusedError("too-large");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new DocxSaveRefusedError("unreadable");
  }
  const { destination: parentPath, from: docName } = parentAndName(docPath);
  return convertDocxIntoNewDoc(bytes, { sourceName: file.name, parentPath, docName }, io, convert);
}
