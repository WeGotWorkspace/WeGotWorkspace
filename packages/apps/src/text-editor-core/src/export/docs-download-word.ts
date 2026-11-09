import type { Editor } from "@tiptap/core";
import {
  defaultTextEditorPageFormat,
  TEXT_EDITOR_PAGE_FORMAT_SPECS,
  TEXT_EDITOR_PAGE_MARGIN_PX,
  type TextEditorPageSetup,
} from "@/lib/page-format";
import { triggerBrowserBlobDownload } from "@/lib/offline/docs/docs-offline-download";
import {
  editorJsonToExportBlocks,
  exportImageSources,
} from "@/text-editor-core/src/export/text-editor-export-blocks";
import { collectExportImages } from "@/text-editor-core/src/export/text-editor-export-images";
import type { DocxPage } from "@/text-editor-core/src/export/docs-docx-writer";

const DOC_EXTENSION = /\.(md|markdown|txt|html?)$/i;
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|\p{Cc}]+/gu;

/** `Quote.md` → `Quote.docx`. Path and control characters become `-`. */
export function docsExportFileName(title: string, extension: string): string {
  const base = title.trim().replace(DOC_EXTENSION, "").replace(UNSAFE_FILE_CHARS, "-").trim();
  return `${base || "Document"}.${extension}`;
}

/** The Doc's paper; paper *None* uses the locale default (A4, Letter for US and Canada). */
export function docsExportPage(
  setup: Pick<TextEditorPageSetup, "format" | "orientation"> | undefined,
  locales: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): DocxPage {
  const format =
    setup && setup.format !== "none" ? setup.format : defaultTextEditorPageFormat(locales);
  const spec = TEXT_EDITOR_PAGE_FORMAT_SPECS[format];
  return {
    width: spec.width,
    height: spec.height,
    landscape: setup?.orientation === "landscape",
    margin: TEXT_EDITOR_PAGE_MARGIN_PX,
  };
}

export type DocsWordDownloadInput = {
  editor: Editor;
  /** The Doc's file name or title, for example `Quote.md`. */
  title: string;
  pageSetup?: Pick<TextEditorPageSetup, "format" | "orientation">;
};

export type DocsWordDownloadResult = { fileName: string; missingImages: number };

/** Build `<Doc name>.docx` from the live editor in the browser and save it. */
export async function downloadDocAsWord(
  input: DocsWordDownloadInput,
): Promise<DocsWordDownloadResult> {
  const blocks = editorJsonToExportBlocks(input.editor.getJSON());
  const [images, { writeDocx }] = await Promise.all([
    collectExportImages(input.editor, exportImageSources(blocks)),
    import("@/text-editor-core/src/export/docs-docx-writer"),
  ]);
  const fileName = docsExportFileName(input.title, "docx");
  const { blob, missingImages } = await writeDocx(blocks, {
    title: fileName.slice(0, -".docx".length),
    page: docsExportPage(input.pageSetup),
    images,
  });
  triggerBrowserBlobDownload(blob, fileName);
  return { fileName, missingImages };
}
