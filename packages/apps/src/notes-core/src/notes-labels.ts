import { workspaceDestructiveDialogLabels } from "@/lib/workspace/destructive-dialog";

/**
 * User-visible copy for the notes workspace (sidebar, list chrome, dialogs, toasts).
 * Override via {@link NotesWorkspaceProps.labels} in stories/tests.
 */
export type NotesUILabels = {
  listLoading: string;
  refreshList: string;
  searchPlaceholder: string;
  sidebarAllItems: string;
  sidebarStarred: string;
  sidebarArchive: string;
  sidebarSharedWithMe: string;
  /** Location label for a single shared note (`Shared by {username}`). */
  sharedBy: (username: string) => string;
  sectionNotebooks: string;
  sectionSharedNotebooks: string;
  sectionTags: string;
  share: string;
  addNotebook: string;
  addTag: string;
  listSelected: (count: number) => string;
  listFiles: (count: number) => string;
  emptyList: string;
  newNote: string;
  edit: string;
  remove: string;
  emptyArchive: string;
  fallbackViewTitle: string;
  toastNewNote: string;
  toastSaved: string;
  toastSynced: string;
  selectionStar: string;
  selectionArchive: string;
  selectionMoveToNotebook: string;
  selectionDeletePermanently: string;
  selectionDone: string;
  swipeStar: string;
  swipeUnstar: string;
  swipeArchive: string;
  swipeUnarchive: string;
  toolbarMoveToNotebook: string;
  toolbarStar: string;
  toolbarArchive: string;
  toolbarUnarchive: string;
  dialogCancel: string;
  dialogDelete: string;
  dialogEmptyArchiveTitle: string;
  dialogDeleteItemsTitle: (count: number) => string;
  dialogEmptyArchiveDescription: (count: number) => string;
  dialogDeleteSelectedDescription: string;
  dialogDeleteConfirmSuffix: string;
  dialogPermanentDeleteLeadIn: string;
  tagViewTitle: (tag: string) => string;
  newNoteCategory: string;
  pendingSync: string;
  conflictTitle: string;
  conflictDescription: (title: string) => string;
  conflictRemaining: (count: number) => string;
  conflictKeepMine: string;
  conflictUseServer: string;
  syncFailedTitle: string;
  syncFailedMessage: string;
  retrySync: string;
  /** Prefix for the detail-footer last-edited chip (`Last edited {time}`). */
  editedLabel: string;
};

export const defaultNotesLabels: NotesUILabels = {
  listLoading: "Loading notes…",
  refreshList: "Refresh notes",
  searchPlaceholder: "Search notes...",
  sidebarAllItems: "All Items",
  sidebarStarred: "Starred",
  sidebarArchive: "Archived",
  sidebarSharedWithMe: "Shared with me",
  sharedBy: (username) => `Shared by ${username}`,
  sectionNotebooks: "Notebooks",
  sectionSharedNotebooks: "Shared notebooks",
  sectionTags: "Tags",
  share: "Share",
  addNotebook: "New notebook",
  addTag: "New tag",
  listSelected: (count) => `${count} Selected`,
  listFiles: (count) => `${count} Files`,
  emptyList: "No items",
  newNote: "New note",
  edit: "Edit",
  remove: "Remove",
  emptyArchive: "Empty archive",
  fallbackViewTitle: "Writings",
  toastNewNote: "New note",
  toastSaved: "Note saved",
  toastSynced: "Changes synced",
  selectionStar: "Star",
  selectionArchive: "Archive",
  selectionMoveToNotebook: "Change notebook",
  selectionDeletePermanently: "Delete permanently",
  selectionDone: "Done",
  swipeStar: "Star",
  swipeUnstar: "Unstar",
  swipeArchive: "Archive",
  swipeUnarchive: "Unarchive",
  toolbarMoveToNotebook: "Change notebook",
  toolbarStar: "Star",
  toolbarArchive: "Archive",
  toolbarUnarchive: "Unarchive",
  dialogCancel: workspaceDestructiveDialogLabels.dialogCancel,
  dialogDelete: workspaceDestructiveDialogLabels.dialogDelete,
  dialogEmptyArchiveTitle: "Empty archive?",
  dialogDeleteItemsTitle: (count) => `Delete ${count} item${count === 1 ? "" : "s"}?`,
  dialogEmptyArchiveDescription: (count) => `all ${count} archived item${count === 1 ? "" : "s"}`,
  dialogDeleteSelectedDescription: "the selected items",
  dialogDeleteConfirmSuffix: workspaceDestructiveDialogLabels.dialogDeleteConfirmSuffix,
  dialogPermanentDeleteLeadIn: workspaceDestructiveDialogLabels.dialogPermanentDeleteLeadIn,
  tagViewTitle: (tag) => tag,
  newNoteCategory: "Note",
  pendingSync: "Pending sync",
  conflictTitle: "Sync conflict",
  conflictDescription: (title) =>
    `"${title}" was changed on the server while you were offline. Keep your version or use the server copy?`,
  conflictRemaining: (count) =>
    count === 1 ? "1 more conflict waiting" : `${count} more conflicts waiting`,
  conflictKeepMine: "Keep mine",
  conflictUseServer: "Use server",
  syncFailedTitle: "Some changes could not sync",
  syncFailedMessage: "Your edits are saved locally. Retry when you are back online.",
  retrySync: "Retry",
  editedLabel: "Last edited ",
};

export function mergeNotesLabels(overrides?: Partial<NotesUILabels>): NotesUILabels {
  if (!overrides) return defaultNotesLabels;
  return { ...defaultNotesLabels, ...overrides };
}
