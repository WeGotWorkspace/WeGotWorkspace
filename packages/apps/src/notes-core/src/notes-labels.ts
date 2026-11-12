import { noPeopleOrTeamsFoundCopy } from "@/share-ui/share-labels";
import {
  workspaceDestructiveDialogLabels,
  type WorkspaceDestructiveDialogLabels,
} from "@/lib/workspace/destructive-dialog";
import { sharePrincipalCopy } from "@/share-ui/share-labels";
import type { TaskProjectDialogLabels } from "@/tasks-core/src/task-project-dialog";
import { mergeWorkspaceLabels, workspaceLabels } from "@/lib/workspace/workspace-labels";
import {
  defaultNotesImportLabels,
  type NotesImportLabels,
} from "@/notes-core/src/notes-import-labels";

/**
 * User-visible copy for the notes workspace (sidebar, list chrome, dialogs, toasts).
 * Override via {@link NotesWorkspaceProps.labels} in stories/tests. Common strings come
 * from `workspaceLabels`; the destructive-dialog keys are shared as-is.
 */
export type NotesUILabels = WorkspaceDestructiveDialogLabels & {
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
  /** Shown when a newly typed tag is outside a-z and hyphen. */
  tagCharsetHint: string;
  /** Header pencil on a tag view: opens the rename tag dialog. */
  editTag: string;
  renameTagTitle: string;
  renameTagDescription: string;
  renameTagNameLabel: string;
  renameTagConfirm: string;
  /** Shown when the new name is already a tag — the two will merge. */
  renameTagMergeHint: (tag: string) => string;
  tagRenamed: (tag: string, count: number) => string;
  tagRenamedSomeSkipped: (tag: string, count: number, skipped: number) => string;
  tagRenameInvalidMessage: string;
  tagRenameUndone: string;
  listSelected: (count: number) => string;
  listItems: (count: number) => string;
  emptyList: string;
  /** Detail pane when no note is selected (CollectionState empty). */
  emptyDetail: string;
  /** Detail pane while a new note waits for the notebooks to load (CollectionState loading). */
  detailCreatingNote: string;
  newNote: string;
  /** Chevron menu on the sidebar segmented New control. */
  newNoteMenu: string;
  edit: string;
  remove: string;
  emptyArchive: string;
  fallbackViewTitle: string;
  toastNewNote: string;
  toastSaved: string;
  toastNotebookCreated: string;
  toastNotebookUpdated: string;
  toastNotebookDeleted: (name: string) => string;
  toastNotebookShareRemoved: string;
  toastSynced: string;
  toastListUpdated: string;
  toastListRefreshFailed: string;
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
  /** Confirm notebook assignment in the change-notebook dialog (draft until clicked). */
  changeNotebookConfirm: string;
  /** Detail action-bar confirm before moving the open note (Contacts address-book pattern). */
  moveNoteTitle: string;
  moveNoteDescription: (notebookName: string) => string;
  moveNoteConfirm: string;
  toolbarStar: string;
  toolbarArchive: string;
  toolbarUnarchive: string;
  dialogEmptyArchiveTitle: string;
  dialogDeleteItemsTitle: (count: number) => string;
  dialogEmptyArchiveDescription: (count: number) => string;
  dialogDeleteSelectedDescription: string;
  tagViewTitle: (tag: string) => string;
  newNoteCategory: string;
  pendingSync: string;
  externalWriteTitle: string;
  externalWriteDescription: (title: string) => string;
  externalWriteKeepMine: string;
  externalWriteUseOutside: string;
  /** Accessible name of the notice bar above the list. */
  noticeBarLabel: string;
  /** The notice bar row while notes fail to sync. */
  syncFailedNotice: string;
  syncFailedMessage: string;
  retrySync: string;
  /** Visible prefix before the last-edited date above the note title ("Edited 17:42"). */
  editedLabel: string;
  accessLostTitle: string;
  accessLostMessage: string;
  noteDeletedElsewhere: (title: string) => string;
  noteArchivedElsewhere: (title: string) => string;
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
  deleteNotebookHasNotesTitle: string;
  deleteNotebookHasNotesDescription: string;
  deleteNotebookMoveToConfirm: (destination: string) => string;
  deleteNotebookUidCollision: string;
  deleteNotebookDestinationReadOnly: string;
  deleteNotebookDeleteNotesToo: string;
  toastNotebookDeletedNotesMoved: (notebook: string, destination: string) => string;
  /** Shown when a new note could not be created in the selected notebook. */
  createNoteFailedMessage: (notebook: string) => string;
} & NotesImportLabels;

export const defaultNotesLabels: NotesUILabels = {
  ...workspaceDestructiveDialogLabels,
  listLoading: "Loading notes…",
  refreshList: "Refresh notes",
  searchPlaceholder: "Search notes...",
  sidebarAllItems: "All Items",
  sidebarStarred: "Starred",
  sidebarArchive: "Archived",
  sidebarSharedWithMe: workspaceLabels.sharing.sharedWithMe,
  sharedBy: (username) => username,
  viewOnly: workspaceLabels.sharing.viewOnly,
  shared: "Shared",
  sectionNotebooks: "My notebooks",
  sectionSharedNotebooks: workspaceLabels.sharing.sharedWithMe,
  sectionTags: "Tags",
  share: "Share",
  titlePlaceholder: "Title",
  addNotebook: "Create notebook",
  addTag: "New tag",
  tagCharsetHint: "Use letters a–z and -",
  editTag: "Edit tag",
  renameTagTitle: "Rename tag",
  renameTagDescription: "Every note with this tag gets the new name.",
  renameTagNameLabel: "Tag name",
  renameTagConfirm: "Rename",
  renameTagMergeHint: (tag) => `“${tag}” already exists. The two tags will be merged.`,
  tagRenamed: (tag, count) => `Renamed to “${tag}” on ${count} note${count === 1 ? "" : "s"}`,
  tagRenamedSomeSkipped: (tag, count, skipped) =>
    `Renamed to “${tag}” on ${count} note${count === 1 ? "" : "s"}. ${skipped} read-only note${skipped === 1 ? "" : "s"} kept the old tag.`,
  tagRenameInvalidMessage: "A tag may only use letters a–z and -",
  tagRenameUndone: "Tag rename undone.",
  listSelected: (count) => `${count} Selected`,
  listItems: (count) => `${count} Items`,
  emptyList: "No items",
  emptyDetail: "Select a note",
  detailCreatingNote: "Creating note…",
  newNote: "New note",
  newNoteMenu: workspaceLabels.list.moreCreateOptions,
  edit: workspaceLabels.dialog.edit,
  remove: workspaceLabels.dialog.remove,
  emptyArchive: "Empty archive",
  fallbackViewTitle: "Writings",
  toastNewNote: "New note",
  toastSaved: "Note saved",
  toastNotebookCreated: "Notebook created",
  toastNotebookUpdated: "Notebook updated",
  toastNotebookDeleted: (name) => `Notebook “${name}” deleted`,
  toastNotebookShareRemoved: "Notebook removed",
  toastSynced: workspaceLabels.sync.changesSynced,
  toastListUpdated: workspaceLabels.list.listUpdated,
  toastListRefreshFailed: "Could not refresh notes. Please try again.",
  selectionStar: "Star",
  selectionArchive: "Archive",
  selectionMoveToNotebook: "Change notebook",
  selectionDeletePermanently: "Delete permanently",
  selectionDone: workspaceLabels.dialog.done,
  swipeStar: "Star",
  swipeUnstar: "Unstar",
  swipeArchive: "Archive",
  swipeUnarchive: "Unarchive",
  toolbarMoveToNotebook: "Change notebook",
  changeNotebookConfirm: "Change",
  moveNoteTitle: "Move note?",
  moveNoteDescription: (notebookName) => `Move this note to “${notebookName}”?`,
  moveNoteConfirm: workspaceLabels.dialog.move,
  toolbarStar: "Star",
  toolbarArchive: "Archive",
  toolbarUnarchive: "Unarchive",
  dialogEmptyArchiveTitle: "Empty archive?",
  dialogDeleteItemsTitle: (count) => `Delete ${count} item${count === 1 ? "" : "s"}?`,
  dialogEmptyArchiveDescription: (count) => `all ${count} archived item${count === 1 ? "" : "s"}`,
  dialogDeleteSelectedDescription: "the selected items",
  tagViewTitle: (tag) => tag,
  newNoteCategory: "Note",
  pendingSync: workspaceLabels.sync.pending,
  externalWriteTitle: "Changed outside the app",
  externalWriteDescription: (title) =>
    `"${title}" was changed outside the app, and you also have unsaved changes. Nothing has been overwritten.`,
  externalWriteKeepMine: "Keep my edits",
  externalWriteUseOutside: "Use the outside version",
  noticeBarLabel: workspaceLabels.noticeBarLabel,
  syncFailedNotice: workspaceLabels.sync.failedNotice,
  syncFailedMessage: "Your edits are saved locally. Retry when you are back online.",
  retrySync: workspaceLabels.dialog.retry,
  editedLabel: "Edited",
  accessLostTitle: "Access lost",
  accessLostMessage: "You no longer have access to this note. Unsaved edits were not stored.",
  noteDeletedElsewhere: (title: string) =>
    `“${title}” was deleted elsewhere. Your offline changes to it were not kept.`,
  noteArchivedElsewhere: (title: string) =>
    `“${title}” was archived elsewhere. Your changes to it were not saved.`,
  shareNotebookTitle: "Share notebook",
  shareNotebookHint: "People you add can open this notebook in Notes.",
  shareNotebookPlaceholder: sharePrincipalCopy.addPlaceholder,
  shareNotebookEmpty: noPeopleOrTeamsFoundCopy,
  shareNotebookOffline: "Sharing is unavailable offline.",
  removeNotebookShareTitle: workspaceLabels.sharing.removeAccessTitle,
  removeNotebookShareConfirm: "They will no longer see this notebook.",
  newNotebookTitle: "New notebook",
  editNotebookTitle: "Edit notebook",
  notebookNameLabel: workspaceLabels.dialog.nameField,
  notebookColorLabel: workspaceLabels.dialog.colorField,
  notebookOwnerLabel: workspaceLabels.sharing.owner,
  notebookOwnerPersonal: (ownerLabel) => ownerLabel,
  notebookOwnerGroup: (name) => name,
  notebookOwnerReadOnly: "Owner cannot be changed for this notebook.",
  changeNotebookOwnerConfirmTitle: "Change notebook owner?",
  changeNotebookOwnerConfirmToGroup: (groupName) =>
    `This notebook will move to ${groupName}. Members of that team will see it.`,
  changeNotebookOwnerConfirmToPersonal: "This notebook will move to your personal notebooks.",
  changeNotebookOwnerConfirm: workspaceLabels.sharing.changeOwner,
  createNotebookButton: workspaceLabels.dialog.create,
  saveNotebookButton: workspaceLabels.dialog.save,
  removeSharedNotebook: "Remove notebook",
  removeSharedNotebookConfirmTitle: "Remove this shared notebook?",
  removeSharedNotebookConfirmDescription: "You will no longer see this notebook.",
  deleteNotebook: "Delete notebook",
  deleteNotebookConfirmTitle: "Delete notebook?",
  deleteNotebookConfirmDescription:
    "Notes in this notebook will be permanently deleted. This cannot be undone.",
  deleteNotebookHasNotesTitle: "This notebook still has notes",
  deleteNotebookHasNotesDescription:
    "Pick a notebook to move them to, or delete them along with the notebook.",
  deleteNotebookMoveToConfirm: (destination) =>
    `Move notes to “${destination}” and delete notebook`,
  deleteNotebookUidCollision:
    "A note in this notebook uses the same id as another note. Pick a different notebook.",
  deleteNotebookDestinationReadOnly: "That notebook is read-only. Pick another notebook.",
  deleteNotebookDeleteNotesToo: "Delete the notes too",
  toastNotebookDeletedNotesMoved: (notebook, destination) =>
    `Deleted “${notebook}”. Its notes moved to “${destination}”.`,
  createNoteFailedMessage: (notebook) =>
    `Could not create a note in “${notebook}”. The notebook may no longer be available.`,
  ...defaultNotesImportLabels,
};

export function mergeNotesLabels(overrides?: Partial<NotesUILabels>): NotesUILabels {
  return mergeWorkspaceLabels(defaultNotesLabels, overrides);
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
