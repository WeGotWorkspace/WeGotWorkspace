import { workspaceDestructiveDialogLabels } from "@/lib/workspace/destructive-dialog";
import type { TaskProjectDialogLabels } from "@/tasks-core/src/task-project-dialog";

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
  /** Grantor username for Shared-with-me file grants (list/detail location). */
  sharedBy: (username: string) => string;
  /** Accessible name for the list-row view-only eye icon. */
  viewOnly: string;
  /** Accessible name for the list-row share icon (owner outgoing shares). */
  shared: string;
  /** Owned collections heading — same pattern as Tasks “My lists” / Calendar “My calendars”. */
  sectionNotebooks: string;
  /** Inbound ACL heading. Prefer {@link sidebarSharedWithMe} at callsites (Tasks pattern). */
  sectionSharedNotebooks: string;
  sectionTags: string;
  share: string;
  titlePlaceholder: string;
  /** Overflow item on the sidebar segmented New control. */
  addNotebook: string;
  addTag: string;
  listSelected: (count: number) => string;
  listItems: (count: number) => string;
  emptyList: string;
  /** Detail pane when no note is selected (CollectionState empty). */
  emptyDetail: string;
  newNote: string;
  /** Chevron menu on the sidebar segmented New control. */
  newNoteMenu: string;
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
  accessLostTitle: string;
  accessLostMessage: string;
  shareNotebookTitle: string;
  shareNotebookHint: string;
  shareNotebookPlaceholder: string;
  shareNotebookEmpty: string;
  shareNotebookOffline: string;
  removeNotebookShareTitle: string;
  removeNotebookShareConfirm: string;
  newNotebookTitle: string;
  editNotebookTitle: string;
  notebookNameLabel: string;
  notebookColorLabel: string;
  notebookOwnerLabel: string;
  notebookOwnerPersonal: (ownerLabel: string) => string;
  notebookOwnerGroup: (name: string) => string;
  notebookOwnerReadOnly: string;
  changeNotebookOwnerConfirmTitle: string;
  changeNotebookOwnerConfirmToGroup: (groupName: string) => string;
  changeNotebookOwnerConfirmToPersonal: string;
  changeNotebookOwnerConfirm: string;
  createNotebookButton: string;
  saveNotebookButton: string;
  removeSharedNotebook: string;
  removeSharedNotebookConfirmTitle: string;
  removeSharedNotebookConfirmDescription: string;
  deleteNotebook: string;
  deleteNotebookConfirmTitle: string;
  deleteNotebookConfirmDescription: string;
};

export const defaultNotesLabels: NotesUILabels = {
  listLoading: "Loading notes…",
  refreshList: "Refresh notes",
  searchPlaceholder: "Search notes...",
  sidebarAllItems: "All Items",
  sidebarStarred: "Starred",
  sidebarArchive: "Archived",
  sidebarSharedWithMe: "Shared with me",
  sharedBy: (username) => username,
  viewOnly: "View only",
  shared: "Shared",
  sectionNotebooks: "My notebooks",
  sectionSharedNotebooks: "Shared with me",
  sectionTags: "Tags",
  share: "Share",
  titlePlaceholder: "Title",
  addNotebook: "Create notebook",
  addTag: "New tag",
  listSelected: (count) => `${count} Selected`,
  listItems: (count) => `${count} Items`,
  emptyList: "No items",
  emptyDetail: "Select a note",
  newNote: "New note",
  newNoteMenu: "More create options",
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
  accessLostTitle: "Access lost",
  accessLostMessage: "You no longer have access to this note. Unsaved edits were not stored.",
  shareNotebookTitle: "Share notebook",
  shareNotebookHint: "People you add can open this notebook in Notes.",
  shareNotebookPlaceholder: "Add people or groups",
  shareNotebookEmpty: "No matches",
  shareNotebookOffline: "Sharing is unavailable offline.",
  removeNotebookShareTitle: "Remove access?",
  removeNotebookShareConfirm: "They will no longer see this notebook.",
  newNotebookTitle: "New notebook",
  editNotebookTitle: "Edit notebook",
  notebookNameLabel: "Name",
  notebookColorLabel: "Color",
  notebookOwnerLabel: "Owner",
  notebookOwnerPersonal: (ownerLabel) => ownerLabel,
  notebookOwnerGroup: (name) => name,
  notebookOwnerReadOnly: "Owner cannot be changed for this notebook.",
  changeNotebookOwnerConfirmTitle: "Change notebook owner?",
  changeNotebookOwnerConfirmToGroup: (groupName) =>
    `This notebook will move to ${groupName}. Members of that group will see it.`,
  changeNotebookOwnerConfirmToPersonal: "This notebook will move to your personal notebooks.",
  changeNotebookOwnerConfirm: "Change owner",
  createNotebookButton: "Create",
  saveNotebookButton: "Save",
  removeSharedNotebook: "Remove notebook",
  removeSharedNotebookConfirmTitle: "Remove this shared notebook?",
  removeSharedNotebookConfirmDescription: "You will no longer see this notebook.",
  deleteNotebook: "Delete notebook",
  deleteNotebookConfirmTitle: "Delete notebook?",
  deleteNotebookConfirmDescription:
    "Notes in this notebook will be permanently deleted. This cannot be undone.",
};

export function mergeNotesLabels(overrides?: Partial<NotesUILabels>): NotesUILabels {
  if (!overrides) return defaultNotesLabels;
  return { ...defaultNotesLabels, ...overrides };
}

export function notesNotebookDialogLabelsFrom(labels: NotesUILabels): TaskProjectDialogLabels {
  return {
    createTitle: labels.newNotebookTitle,
    editTitle: labels.editNotebookTitle,
    nameLabel: labels.notebookNameLabel,
    colorLabel: labels.notebookColorLabel,
    scopeLabel: labels.notebookOwnerLabel,
    scopePersonal: labels.notebookOwnerPersonal,
    scopeGroup: labels.notebookOwnerGroup,
    scopeReadOnlyLabel: labels.notebookOwnerReadOnly,
    changeOwnerConfirmTitle: labels.changeNotebookOwnerConfirmTitle,
    changeOwnerConfirmToGroup: labels.changeNotebookOwnerConfirmToGroup,
    changeOwnerConfirmToPersonal: labels.changeNotebookOwnerConfirmToPersonal,
    changeOwnerConfirm: labels.changeNotebookOwnerConfirm,
    createButton: labels.createNotebookButton,
    saveButton: labels.saveNotebookButton,
    cancel: labels.dialogCancel,
    shareListSectionTitle: labels.shareNotebookTitle,
    shareListSectionHint: labels.shareNotebookHint,
    shareListAddPlaceholder: labels.shareNotebookPlaceholder,
    shareListSearchEmpty: labels.shareNotebookEmpty,
    shareListOffline: labels.shareNotebookOffline,
    removeListShareTitle: labels.removeNotebookShareTitle,
    removeListShareConfirm: labels.removeNotebookShareConfirm,
    removeSharedList: labels.removeSharedNotebook,
    removeSharedListConfirmTitle: labels.removeSharedNotebookConfirmTitle,
    removeSharedListConfirmDescription: labels.removeSharedNotebookConfirmDescription,
    deleteList: labels.deleteNotebook,
    deleteListConfirmTitle: labels.deleteNotebookConfirmTitle,
    deleteListConfirmDescription: labels.deleteNotebookConfirmDescription,
    delete: labels.dialogDelete,
  };
}
