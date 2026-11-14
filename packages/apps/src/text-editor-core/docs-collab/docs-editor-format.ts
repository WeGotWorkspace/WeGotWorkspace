import { extensionFromFileName } from "@/lib/files/file-name-utils";
import { DOCS_COLLAB_TEXT_EXTENSIONS } from "@/lib/files/docs-collab-text-files";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";

/** Map a drive file name to the text-editor serialization format. */
export function docsEditorFormatFromFileName(
  fileName: string,
  apiPath?: string,
): TextEditorContentFormat {
  let ext = extensionFromFileName(fileName);
  if (!ext && apiPath) {
    ext = extensionFromFileName(apiPath.split("/").pop() ?? "");
  }
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html") return "html";
  if (ext === "txt" || DOCS_COLLAB_TEXT_EXTENSIONS.has(ext)) return "text";
  return "markdown";
}

export function isDocsPlainTextFile(fileName: string): boolean {
  return docsEditorFormatFromFileName(fileName) === "text";
}
