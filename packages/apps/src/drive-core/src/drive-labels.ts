import { filesBrowserSidebarLabels } from "@/drive-core/src/files-browser-sidebar";
import type { DriveFile } from "@/drive-core/src/drive-models";

export const driveLabels = {
  /** Primary AppSidebar home (SST with Docs; Docs uses "My Docs"). */
  sidebarHome: filesBrowserSidebarLabels.homeDrive,
  /**
   * Personal-drive display label (sidebar, breadcrumbs, location, pickers).
   * UI path key remains `"My Drive"`; string SST is {@link filesBrowserSidebarLabels.personalDrive}.
   */
  sidebarMyDrive: filesBrowserSidebarLabels.personalDrive,
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
  /** Folder view when the live listing failed and no rows are shown — never "empty". */
  folderListingFailed: "This folder could not be loaded",
  folderListingRetry: "Try again",
  dropUploadHint: "Drop files to upload to",
  newButton: "New",
  /** Chevron menu on the sidebar segmented New control. */
  newButtonMenu: "More create options",
  newFolder: "New folder",
  uploadFiles: "Upload files",
  /** Status of a file in the upload queue (placeholder row, ring, Uploads view). */
  uploadState: {
    waiting: "Waiting to upload",
    waitingOffline: "Waiting for a connection",
    waitingForAnswer: "Waiting for your answer",
    waitingServerFull: "Waiting for space on the server",
    uploading: "Uploading",
    assembling: "Finishing on the server",
    failed: "Upload failed",
  },
  /** Why an upload failed, shown after "Upload failed". */
  uploadFailedReason: {
    too_large: "Too large to upload",
    quota: "No room on this device",
    server_full: "The server is full",
    auth: "Sign in again to upload",
    forbidden: "You can no longer add files to this folder",
    target_missing: "The folder no longer exists",
    no_local_copy: "File no longer on this device",
    insecure_context: "Large files need a secure connection (https)",
    transient: "The server kept failing",
    permanent: "Server did not accept it",
  },
  /** After a `no_local_copy` or `quota` reason: the bytes are gone. */
  uploadAddAgain: "Add the file again",
  /** Short note on a file uploading straight from memory (device storage fallback). */
  uploadNotOnDevice: "Not saved on this device",
  uploadNotOnDeviceDetail:
    "This file is not saved on this device, so it won't survive going offline or a reload. Keep this tab open until it is uploaded.",
  /** Accessible name of the progress ring. */
  uploadRingName: (fileName: string) => `Upload of ${fileName}`,
  uploadPercent: (percent: number) => `${percent}%`,
  uploadRetry: "Retry",
  uploadRetryAll: "Retry all failed",
  uploadRemove: "Remove",
  /** Description on actions a placeholder cannot do yet (open, share, move, rename…). */
  uploadActionUnavailable: "Available after the upload",
  uploadOpenUnavailable: "This file is still uploading. You can open it once it is uploaded.",
  /** Toast when files are queued: nothing is on the server yet. */
  uploadAddedToast: (count: number) => `Added ${fileCount(count)} to uploads`,
  /** Toast once a batch has finished. */
  uploadDoneToast: (count: number) => `Uploaded ${fileCount(count)}`,
  uploadPartlyDoneToast: (done: number, total: number) =>
    `Uploaded ${done} of ${fileCount(total)}. See Uploads for the rest.`,
  uploadFailedToast: (count: number) =>
    `${count === 1 ? "1 file" : `${count} files`} could not be uploaded. See Uploads.`,
  /** Floating bar of a direct upload (no queue: mock, guest). */
  uploadingFile: (fileName: string) => `Uploading ${fileName}`,
  uploadingFiles: (count: number) => `Uploading ${fileCount(count)}`,
  uploadComplete: "Upload complete",
  uploadProgressDetail: (bytesDone: string, bytesTotal: string, done: number, total: number) =>
    `${bytesDone} / ${bytesTotal} · ${done}/${fileCount(total)}`,
  /** Screen reader announcements (polite live region). */
  uploadAnnounceStarted: (fileName: string) => `Uploading ${fileName}`,
  uploadAnnounceProgress: (fileName: string, percent: number) =>
    `Uploading ${fileName}, ${percent}%`,
  uploadAnnounceDone: (fileName: string) => `${fileName} uploaded`,
  uploadAnnounceFailed: (fileName: string, reason: string) =>
    `${fileName} could not be uploaded: ${reason}`,
  sidebarUploads: filesBrowserSidebarLabels.uploads,
  /** Accessible text of the Uploads sidebar badge. */
  uploadsBadge: (count: number, failed: number) =>
    failed > 0 ? `${fileCount(count)}, ${failed} failed` : fileCount(count),
  uploadsSummary: (count: number, failed: number) =>
    failed > 0 ? `${fileCount(count)} · ${failed} failed` : fileCount(count),
  uploadsAllDone: "All uploads are done",
  uploadsGoToFolder: (folder: string) => `Go to ${folder}`,
  uploadsTargetFolder: (folder: string) => `Uploading to ${folder}`,
  uploadsNoMatch: "No uploads match your search",
  newMarkdown: "New document",
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
  fileSelectDialogTitle: "Insert image",
  fileSelectDialogDescription:
    "Browse folders like in Drive. Click an image to select it, or open a folder to keep browsing.",
  fileSelectDialogInsert: "Insert",
  fileSelectEmpty: "No images in this folder",
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
  toastSynced: "Changes synced",
  syncFailedTitle: "Some changes could not sync",
  syncFailedMessage:
    "Your edits are saved on this device. Retry temporary failures. Changes the server rejected stay listed.",
  retrySync: "Retry sync",
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

/** "1 file", "3 files". */
export function fileCount(count: number): string {
  return `${count} ${FILE_PLURAL.select(count) === "one" ? "file" : "files"}`;
}

const FILE_PLURAL = new Intl.PluralRules("en");

/**
 * Status of a placeholder from its cached row alone: "Waiting to upload",
 * "Uploading", or "Upload failed · <reason>". The live queue adds more detail
 * (see `driveUploadRowState`).
 */
export function driveUploadStatusText(upload: NonNullable<DriveFile["upload"]>): string {
  if (upload.status === "queued") return driveLabels.uploadState.waiting;
  if (upload.status === "uploading") return driveLabels.uploadState.uploading;
  if (!upload.reason) return driveLabels.uploadState.failed;
  return `${driveLabels.uploadState.failed} · ${driveLabels.uploadFailedReason[upload.reason]}`;
}
