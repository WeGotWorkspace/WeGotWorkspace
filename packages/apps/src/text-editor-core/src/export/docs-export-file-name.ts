const DOC_EXTENSION = /\.(md|markdown|txt|html?)$/i;
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|\p{Cc}]+/gu;

/** `Quote.md` → `Quote.docx`. Path and control characters become `-`. */
export function docsExportFileName(title: string, extension: string): string {
  const base = title.trim().replace(DOC_EXTENSION, "").replace(UNSAFE_FILE_CHARS, "-").trim();
  return `${base || "Document"}.${extension}`;
}
