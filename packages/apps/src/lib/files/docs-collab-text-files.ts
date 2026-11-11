import { extensionFromFileName } from "@/lib/files/file-name-utils";

/** Extensions allowed for Yjs collab editing (explicit allowlist). */
export const DOCS_COLLAB_TEXT_EXTENSIONS = new Set([
  "csv",
  "env",
  "html",
  "ini",
  "json",
  "log",
  "md",
  "markdown",
  "toml",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

function fileNameFromApiPath(path: string): string {
  const normalized = path.trim().replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/** Whether a drive virtual path should open in the collab text editor. */
export function isDocsCollabEditablePath(path: string | null | undefined): boolean {
  if (typeof path !== "string" || path.trim() === "") return false;
  const ext = extensionFromFileName(fileNameFromApiPath(path));
  return ext !== "" && DOCS_COLLAB_TEXT_EXTENSIONS.has(ext);
}
