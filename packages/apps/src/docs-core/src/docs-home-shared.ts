/**
 * Docs home "Shared with me" — filters member-shared Drive entries to the same
 * Markdown / plain-text allowlist used by Docs home browse (`DOCS_HOME_LIST_EXTENSIONS`).
 * Folders are omitted (Docs opens files, not folder browse).
 */
import { extensionFromFileName } from "@/lib/files/file-name-utils";
import type { DriveFile } from "@/lib/files/drive-models";
import { DOCS_HOME_LIST_EXTENSIONS } from "@/lib/files/docs-home-listing";

const DOCS_HOME_EXTENSION_SET = new Set<string>(DOCS_HOME_LIST_EXTENSIONS);

/** Sidebar / listing selection for Docs home (All Docs, Shared with me, virtual views, or a drive). */
export type DocsHomeView =
  | { type: "all" }
  | { type: "shared" }
  | { type: "recent" }
  | { type: "starred" }
  | { type: "trash" }
  /** Every doc with one tag, across drives (#2402). */
  | { type: "tag"; tag: string }
  | { type: "drive"; pathPrefix: string };

/** True when a file title/path has a Docs-home list extension (md / markdown / txt, plus docx / gdoc for Save as Markdown). */
export function isDocsHomeCompatibleExtension(fileName: string): boolean {
  return DOCS_HOME_EXTENSION_SET.has(extensionFromFileName(fileName));
}

/**
 * Whether a Shared with me (or other) `DriveFile` belongs in Docs home Shared with me.
 * Folders are excluded; only allowlisted document extensions are kept.
 */
export function isDocsHomeCompatibleSharedFile(
  file: Pick<DriveFile, "kind" | "title" | "apiPath">,
): boolean {
  if (file.kind === "folder") return false;
  const name = file.title.trim() || file.apiPath?.split("/").pop()?.trim() || "";
  return isDocsHomeCompatibleExtension(name);
}

/** Client-side title filter for the Shared with me listing (no server search). */
export function filterDocsHomeSharedByQuery(
  files: readonly DriveFile[],
  query: string,
): DriveFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...files];
  return files.filter((file) => file.title.toLowerCase().includes(q));
}

/**
 * Creating from Shared with me, Recent, Starred or Trash first opens Personal,
 * so the new document lands in a drive the person is looking at.
 */
export function docsHomeCreateJumpsToPersonal(view: DocsHomeView): boolean {
  return view.type !== "all" && view.type !== "drive";
}

/** Search `pathPrefix` when the view is a single drive; otherwise undefined. */
export function docsHomeBrowsePathPrefix(view: DocsHomeView): string | undefined {
  return view.type === "drive" ? view.pathPrefix : undefined;
}
