import {
  buildDocxImportReport,
  type DocxImportReport,
} from "@/docs-core/src/docx-import/docx-import-report";
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

/** `Report.docx` → `Report.md`. */
export function markdownNameFor(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = (dot > 0 ? sourceName.slice(0, dot) : sourceName).trim() || "Untitled";
  return `${base}.md`;
}

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
  io: SaveAsMarkdownIo,
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

/**
 * Converts the Word file at `sourcePath` into a new `.md` next to it.
 * Every refusal is decided before anything is written. Order after that:
 * create the empty Doc, upload images, write the Markdown once.
 */
export async function saveDocxAsMarkdown(
  sourcePath: string,
  io: SaveAsMarkdownIo,
  convert: Convert,
): Promise<SaveAsMarkdownResult> {
  const { destination: parentPath, from: sourceName } = parentAndName(sourcePath);
  const bytes = await io.readSource(sourcePath);
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

  const { name, nodeId } = await io.createEmptyDoc(parentPath, markdownNameFor(sourceName));
  const docPath = `${parentPath.replace(/\/+$/, "")}/${name}`;
  try {
    const { markdown, failed } = await uploadImages(io, docPath, nodeId, conversion);
    await io.writeDoc(nodeId, markdown);
    return { docPath, report: buildDocxImportReport(sourceName, scan.counts, failed) };
  } catch (error) {
    await io.removeDoc(docPath, nodeId).catch(() => undefined);
    throw error;
  }
}
