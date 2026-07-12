export const driveLabels = {
  sidebarMyDrive: "My Drive",
  sidebarRecent: "Recent",
  sidebarStarred: "Starred",
  sidebarTrash: "Trash",
  sidebarAccess: "Access",
  sidebarSharedDrives: "Shared drives",
  searchPlaceholder: "Search in Drive...",
  searchViewTitle: "Search",
  listColumnName: "Name",
  listColumnActions: "Actions",
  listColumnOffline: "Offline",
  emptyFolder: "This folder is empty",
  folderListingLoading: "Loading folder…",
  dropUploadHint: "Drop files to upload to",
  newButton: "New",
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
} as const;

export type DriveUILabels = typeof driveLabels;

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
