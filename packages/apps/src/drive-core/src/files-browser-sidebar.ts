/**
 * Shared Docs / Drive AppSidebar SST — primary nav order + drives section.
 * Product-specific home label: Docs {@link filesBrowserSidebarLabels.homeDocs},
 * Drive {@link filesBrowserSidebarLabels.homeDrive}.
 */

export const filesBrowserSidebarLabels = {
  /** Docs primary home (all-docs listing). */
  homeDocs: "My Docs",
  /** Drive primary home (maps to My Drive root view). */
  homeDrive: "My Files",
  sharedWithMe: "Shared with me",
  recent: "Recent",
  starred: "Starred",
  trash: "Trash",
  drivesSection: "My Drives",
  /** Personal drive row under My Drives (UI path key remains `"My Drive"`). */
  personalDrive: "Personal",
} as const;

export type FilesBrowserSidebarPrimaryId = "home" | "shared" | "recent" | "starred" | "trash";

/** Canonical primary sidebar order for Docs home and Drive. */
export const FILES_BROWSER_SIDEBAR_PRIMARY_ORDER = [
  "home",
  "shared",
  "recent",
  "starred",
  "trash",
] as const satisfies readonly FilesBrowserSidebarPrimaryId[];

export function filesBrowserHomeLabel(product: "docs" | "drive"): string {
  return product === "docs"
    ? filesBrowserSidebarLabels.homeDocs
    : filesBrowserSidebarLabels.homeDrive;
}
