/**
 * Docs home "Shared with me" — filters member-shared Drive entries to the same
 * Markdown / plain-text allowlist used by Docs home browse (`DOCS_HOME_EXTENSIONS`).
 * Folders are omitted (Docs opens files, not folder browse).
 */
import {
  driveFileFromSharedWithMeEntry,
  extensionFromFileName,
} from "@/drive-core/src/drive-file-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveSharedWithMeEntry } from "@wgw-api-generated/drive-types";
import { DOCS_HOME_EXTENSIONS } from "@/docs-core/src/docs-home-constants";

const DOCS_HOME_EXTENSION_SET = new Set<string>(DOCS_HOME_EXTENSIONS);

/** Sidebar / listing selection for Docs home (All docs, Shared with me, or a drive). */
export type DocsHomeView =
  | { type: "all" }
  | { type: "shared" }
  | { type: "drive"; pathPrefix: string };

/** True when a file title/path has a Docs-home browse extension (md / markdown / txt). */
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

/** Map + filter `shared-with-me` API entries to Docs-compatible files only. */
export function mapDocsHomeSharedEntries(
  entries: readonly DriveSharedWithMeEntry[],
  username: string,
): DriveFile[] {
  const files: DriveFile[] = [];
  for (const entry of entries) {
    const file = driveFileFromSharedWithMeEntry(entry, username);
    if (!file || !isDocsHomeCompatibleSharedFile(file)) continue;
    files.push(file);
  }
  return files;
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

/** Browse `pathPrefix` for unified search when the view is a single drive; otherwise undefined. */
export function docsHomeBrowsePathPrefix(view: DocsHomeView): string | undefined {
  return view.type === "drive" ? view.pathPrefix : undefined;
}

/**
 * Merge All-docs browse results with Shared with me docs.
 * Dedupes by `apiPath` (browse wins for listing order). Shared location / `isShared`
 * overlay browse rows so foreign `/users/{owner}/…` paths are not labeled as My Drive.
 */
export function mergeDocsHomeBrowseWithShared(
  browseFiles: readonly DriveFile[],
  sharedFiles: readonly DriveFile[],
): DriveFile[] {
  const sharedByPath = new Map<string, DriveFile>();
  for (const file of sharedFiles) {
    const key = file.apiPath?.trim() || file.id;
    sharedByPath.set(key, file);
  }

  const seen = new Set<string>();
  const merged: DriveFile[] = [];
  for (const file of browseFiles) {
    const key = file.apiPath?.trim() || file.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const shared = sharedByPath.get(key);
    if (!shared) {
      merged.push(file);
      continue;
    }
    merged.push({
      ...file,
      parent: shared.parent,
      location: shared.location ?? file.location,
      isShared: shared.isShared ?? file.isShared,
      hasPublicShare: file.hasPublicShare ?? shared.hasPublicShare,
    });
  }
  for (const file of sharedFiles) {
    const key = file.apiPath?.trim() || file.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged;
}
