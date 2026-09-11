import { filesBrowserSidebarLabels } from "@/drive-core/src/files-browser-sidebar";

export const driveLabels = {
  /** Primary AppSidebar home (SST with Docs; Docs uses "My Docs"). */
  sidebarHome: filesBrowserSidebarLabels.homeDrive,
  /**
   * Personal-drive path / breadcrumb / location label (`"My Drive"` UI path key).
   * Sidebar row under My Drives uses {@link driveLabels.sidebarPersonalDrive}.
   */
  sidebarMyDrive: "My Drive",
  /** Personal drive row under My Drives (same SST as Docs). */
  sidebarPersonalDrive: filesBrowserSidebarLabels.personalDrive,
  sidebarSharedWithMe: filesBrowserSidebarLabels.sharedWithMe,
  sidebarRecent: filesBrowserSidebarLabels.recent,
  sidebarStarred: filesBrowserSidebarLabels.starred,
  sidebarTrash: filesBrowserSidebarLabels.trash,
  /** My Drives section title (SST with Docs; was "Team drives"). */
  sidebarSharedDrives: filesBrowserSidebarLabels.drivesSection,
  searchPlaceholder: "Search in Drive...",
  searchViewTitle: "Search",
  listColumnName: "Name",
  listColumnLocation: "Location",
  listColumnActions: "Actions",
  listColumnOffline: "Offline",
  emptyFolder: "This folder is empty",
  folderListingLoading: "Loading folder…",
  dropUploadHint: "Drop files to upload to",
  newButton: "New",
  /** Chevron menu on the sidebar segmented New control. */
  newButtonMenu: "More create options",
  newFolder: "New folder",
  uploadFiles: "Upload files",
  newMarkdown: "New document",
  /** Office plugin blank templates (Drive overrides plugin manifest labels). */
  newDocument: "New docx",
  newSpreadsheet: "New xlsx",
  newPresentation: "New pptx",
  gridView: "Grid view",
  listView: "List view",
  detailPanelToggle: "Details panel",
  /** DocsCollabSidebarPanel title for the file detail side panel. */
  detailSidebarTitle: "Details",
  detailClosePanel: "Close",
  /** Empty body when the details panel is open with no file selected. */
  detailEmpty: "Select a file to see its details.",
  selectionDone: "Done",
  selectionStar: "Star",
  selectionMove: "Move",
  selectionDownload: "Download",
  selectionMoveToTrash: "Move to trash",
  selectionDeletePermanently: "Delete permanently",
  detailOpen: "Open",
  detailDownload: "Download",
  detailStar: "Star",
  detailUnstar: "Unstar",
  detailRename: "Rename",
  renameDialogTitle: "Rename item",
  renameDialogDescription: "Enter a new name. File extensions cannot be changed.",
  renameDialogDescriptionFolder: "Enter a new name for this folder.",
  renameAction: "Rename",
  cancel: "Cancel",
  detailMove: "Move",
  detailShare: "Share",
  detailDelete: "Delete",
  folderPickerDrivesRoot: "Drives",
  moveDialogTitle: "Move to folder",
  moveDialogDescription:
    "Browse folders like in Drive. Click to select a destination, double-click to open a folder.",
  moveDialogSearchPlaceholder: "Search folders…",
  moveDialogEmpty: "No folders match your search.",
  moveDialogCancel: "Cancel",
  moveDialogConfirm: "Move here",
  createMarkdownDialogTitle: "New document",
  createMarkdownDialogDescription: "Choose a name and folder before creating the document.",
  createMarkdownDialogNamePlaceholder: "Name",
  createMarkdownDialogCancel: "Cancel",
  createMarkdownDialogConfirm: "Create",
  offlineMakeAvailable: "Make available offline",
  offlineRemoveCopy: "Remove offline copy",
  offlineDownloading: "Downloading for offline use",
  offlineAvailable: "Available offline",
  offlinePendingSync: "Pending sync",
  accessTitle: "Access",
  accessScopesTitle: "Scopes",
  accessRevokeAllPublic: "Revoke all public links",
  accessManageShare: "Manage share",
  accessSearchPlaceholder: "Search people and groups…",
  accessFilterAll: "All",
  accessFilterExternal: "External",
  accessFilterPublic: "Public links",
  accessFilterGroups: "Groups",
  accessVia: "via",
  accessExternalBadge: "External",
  accessExpiredBadge: "Expired",
  accessPendingBadge: "Pending",
  accessPublicLink: "Public link",
  accessPersonDrawerTitle: "Access for",
  accessNoGrants: "No grants match your filters.",
  accessLoading: "Loading access…",
  accessRevokeSuccess: "Public links revoked",
  sharedIndicator: "Shared",
  publicShareIndicator: "Public link",
  teamShareIndicator: "Shared with team",
  /** Location column for items received via Shared with me. */
  sharedBy: (username: string) => `Shared by ${username}`,
} as const;

/** Writable labels bag — string fields widen so products (Docs) can SST-override. */
export type DriveUILabels = {
  [K in keyof typeof driveLabels]: (typeof driveLabels)[K] extends string
    ? string
    : (typeof driveLabels)[K];
};

export type DriveOfficeBlankKind = "doc" | "sheet" | "slides";

/** Product labels for Office plugin new-file menu items (not the Docs editor). */
export function driveOfficeNewFileLabel(kind: DriveOfficeBlankKind): string {
  switch (kind) {
    case "doc":
      return driveLabels.newDocument;
    case "sheet":
      return driveLabels.newSpreadsheet;
    case "slides":
      return driveLabels.newPresentation;
  }
}
