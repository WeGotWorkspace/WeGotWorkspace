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

/**
 * Whether the person may create files beside `file`. Search rows carry no rights,
 * so unknown counts as "no" unless the file sits in the person's own drive.
 */
function mayCreateBeside(
  file: Pick<DriveFile, "mayManageStructure" | "apiPath">,
  username: string | undefined,
): boolean {
  if (file.mayManageStructure !== undefined) return file.mayManageStructure;
  return Boolean(username && file.apiPath?.startsWith(`/users/${username}/`));
}

export function saveAsMarkdownSourceKind(
  file: Pick<DriveFile, "kind" | "title" | "mayManageStructure" | "apiPath">,
  username?: string,
): SaveAsMarkdownSourceKind | null {
  if (file.kind === "folder") return null;
  if (!mayCreateBeside(file, username)) return null;
  return saveAsMarkdownSourceKindFromName(file.title);
}

/** Listed in Docs for Save as Markdown, but never opened in the editor or synced offline. */
export function isSaveAsMarkdownOnlyFile(file: Pick<DriveFile, "title">): boolean {
  return saveAsMarkdownSourceKindFromName(file.title) !== null;
}
