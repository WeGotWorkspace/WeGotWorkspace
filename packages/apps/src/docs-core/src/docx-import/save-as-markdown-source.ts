import type { DriveFile } from "@/drive-core/src/drive-models";
import { extensionFromFileName } from "@/drive-core/src/drive-file-utils";

/** Word files convert; `.gdoc` (Google Drive for desktop) is only a link and explains itself. */
export type SaveAsMarkdownSourceKind = "docx" | "gdoc";

/** Extensions the Docs file list adds to its own md/markdown/txt for this action. */
export const SAVE_AS_MARKDOWN_SOURCE_EXTENSIONS = ["docx", "gdoc"] as const;

export function saveAsMarkdownSourceKindFromName(name: string): SaveAsMarkdownSourceKind | null {
  const extension = extensionFromFileName(name);
  return extension === "docx" || extension === "gdoc" ? extension : null;
}

export function saveAsMarkdownSourceKind(
  file: Pick<DriveFile, "kind" | "title" | "mayManageStructure">,
): SaveAsMarkdownSourceKind | null {
  if (file.kind === "folder") return null;
  // A file the person may not change usually sits in a folder they cannot write to.
  if (file.mayManageStructure === false) return null;
  return saveAsMarkdownSourceKindFromName(file.title);
}

/** Listed in Docs for Save as Markdown, but never opened in the editor or synced offline. */
export function isSaveAsMarkdownOnlyFile(file: Pick<DriveFile, "title">): boolean {
  return saveAsMarkdownSourceKindFromName(file.title) !== null;
}
