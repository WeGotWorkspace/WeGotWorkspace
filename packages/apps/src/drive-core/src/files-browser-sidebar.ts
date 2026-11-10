/**
 * Shared Docs / Drive AppSidebar SST — primary nav order + drives section.
 * Product-specific home label: Docs {@link filesBrowserSidebarLabels.homeDocs},
 * Drive {@link filesBrowserSidebarLabels.homeDrive}.
 */

export const filesBrowserSidebarLabels = {
  /** Docs primary home: every document across the drives. */
  homeDocs: "All Docs",
  /** Drive primary home: every file across the drives (`{ type: "all" }`). */
  homeDrive: "All Files",
  sharedWithMe: "Shared with me",
  recent: "Recent",
  starred: "Starred",
  /** Drive only: files waiting to upload or failed. Docs hides the entry. */
  uploads: "Uploads",
  trash: "Trash",
  drivesSection: "My Drives",
  /** Root label for Team drives (UI path key remains `"Groups"`). */
  teamsRoot: "Teams",
  /** Personal drive row under My Drives (UI path key remains `"My Drive"`). */
  personalDrive: "Personal",
  /** Next page of a long listing loading at the scroll end (All Docs, All Files). */
  loadingMore: "Loading more…",
  /** First page of All Docs / All Files. */
  listLoading: "Loading…",
} as const;

export type FilesBrowserSidebarPrimaryId =
  "home" | "shared" | "recent" | "starred" | "uploads" | "trash";

/**
 * Canonical primary sidebar order for Docs home and Drive. Each app supplies
 * every id; an app without an entry maps it to `null` on purpose (Docs has no
 * upload queue, so it hides `uploads`).
 */
export const FILES_BROWSER_SIDEBAR_PRIMARY_ORDER = [
  "home",
  "shared",
  "recent",
  "starred",
  "uploads",
  "trash",
] as const satisfies readonly FilesBrowserSidebarPrimaryId[];

export function filesBrowserHomeLabel(product: "docs" | "drive"): string {
  return product === "docs"
    ? filesBrowserSidebarLabels.homeDocs
    : filesBrowserSidebarLabels.homeDrive;
}
