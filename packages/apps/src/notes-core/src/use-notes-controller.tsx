import { useCallback } from "react";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import type { NotesUILabels } from "./notes-labels";
import type { NotesAPIOperations, NotesUIData } from "@/lib/models/notes-types";
import { useArchivedNoteFollowsView } from "./use-archived-note-follows-view";
import { useNoteArchivedElsewhere } from "./use-note-archived-elsewhere";
import { useNoteCreateWhenReady } from "./use-note-create-when-ready";
import { useNoteCreated } from "./use-note-created";
import { useNoteDropped } from "./use-note-dropped";
import { useNotesList } from "./use-notes-list";
import { useNotesMutations } from "./use-notes-mutations";
import { useNotesNotebookMutations } from "./use-notes-notebook-mutations";
import { useNotesShell } from "./use-notes-shell";
import { useNotesTagRename, useNotesTagRenameCollaborators } from "./use-notes-tag-rename";
import { useCloseNoteOutsideProject, useNotesProjectScope } from "./use-notes-project-scope";

type UseNotesControllerArgs = {
  data: NotesUIData;
  labels?: Partial<NotesUILabels>;
  listLoading?: boolean;
  operations?: NotesAPIOperations;
  bootstrapRevision?: number;
  initialView?: string;
  initialNoteId?: string;
  onViewChange?: (view: string) => void;
  onNoteChange?: (noteId: string) => void;
};

/**
 * Notes workspace controller: composes shell navigation, list/selection, and mutation slices.
 * See useNotesShell, useNotesList, and useNotesMutations for domain-specific state.
 */
export function useNotesController({
  data,
  labels,
  listLoading = false,
  operations,
  bootstrapRevision = 0,
  initialView,
  initialNoteId,
  onViewChange,
  onNoteChange,
}: UseNotesControllerArgs) {
  const shell = useNotesShell({
    data,
    labels,
    listLoading,
    operations,
    bootstrapRevision,
    initialView,
    onViewChange,
  });
  const projectScope = useNotesProjectScope(shell);
  const { projectSelected, projectNotebooks } = projectScope;
  const list = useNotesList({ shell: projectScope.listShell, initialNoteId, onNoteChange });
  useCloseNoteOutsideProject(list.active, projectNotebooks, list.closeMobileDetail);
  useNoteCreated(shell.setNotes);
  useNoteDropped(shell.setNotes, (title) =>
    shell.showMutationError(shell.L.noteDeletedElsewhere(title)),
  );
  useNoteArchivedElsewhere(shell.setNotes, (title) =>
    shell.showMutationError(shell.L.noteArchivedElsewhere(title)),
  );
  useArchivedNoteFollowsView({
    serverNotes: shell.data.notes,
    activeId: list.activeId,
    archived: shell.archived,
    view: shell.view,
    setView: shell.setView,
  });

  const selectView = useCallback(
    (nextView: string) => {
      list.setActiveId("");
      shell.selectView(nextView);
    },
    [list, shell],
  );
  const mutations = useNotesMutations({ shell, list });
  const notebookMutations = useNotesNotebookMutations({ shell });
  const tagRenameCollaborators = useNotesTagRenameCollaborators(shell, list);
  const { renameTag } = useNotesTagRename({
    shell,
    queueMutation: list.queueMutation,
    ...tagRenameCollaborators,
  });

  useWorkspaceListKeyboardShortcuts({
    searchInputRef: shell.searchInputRef,
    selectedCount: list.selectedIds.length,
    selectionMode: list.selectionMode,
    onRequestDeleteSelection: mutations.requestDeleteSelected,
    onNavigateList: list.navigateListByKeyboard,
    onUndoQueuedAction: list.undoLatest,
  });

  // Every account has a default notebook: an empty list has not loaded yet (#2055).
  const { createNote, pending: noteCreatePending } = useNoteCreateWhenReady(
    mutations.createNote,
    shell.notebookCollections.length > 0,
  );

  return {
    L: shell.L,
    notes: shell.notes,
    setNotes: shell.setNotes,
    // With a Project selected the sidebar lists only its notebooks (#818).
    notebooks: projectSelected ? [] : shell.notebooks,
    sharedNotebooks: projectSelected ? [] : shell.sharedNotebooks,
    notebookCollections: projectNotebooks ?? shell.notebookCollections,
    groups: shell.groups,
    // "New notebook" is hidden while a Project is selected.
    canManageNotebooks: notebookMutations.canManageNotebooks && !projectSelected,
    notebookDialog: notebookMutations.notebookDialog,
    setNotebookDialog: notebookMutations.setNotebookDialog,
    openCreateNotebookDialog: notebookMutations.openCreateNotebookDialog,
    openEditNotebookDialog: notebookMutations.openEditNotebookDialog,
    createNotebookCollection: notebookMutations.createNotebook,
    updateNotebookCollection: notebookMutations.updateNotebook,
    deleteNotebookCollection: notebookMutations.deleteNotebookCollection,
    notebookDeleteDialog: notebookMutations.notebookDeleteDialog,
    patchNotebookShareWith: notebookMutations.patchShareWith,
    removeSharedNotebook: notebookMutations.removeSharedNotebook,
    tags: shell.tags,
    active: list.active,
    activeId: list.activeId,
    view: shell.view,
    viewLabel: shell.viewLabel,
    starred: shell.starred,
    archived: shell.archived,
    selectedIds: list.selectedIds,
    selectionMode: list.selectionMode,
    canCreateNote: projectScope.canCreateNote,
    searchQuery: shell.searchQuery,
    searchInputRef: shell.searchInputRef,
    moveDialog: mutations.moveDialog,
    editDialog: mutations.editDialog,
    deleteDialog: mutations.deleteDialog,
    visibleNotes: list.visibleNotes,
    listSort: list.listSort,
    setListSort: list.setListSort,
    workspaceLayoutRef: shell.workspaceLayoutRef,
    isTouch: list.isTouch,
    confirmDialog: mutations.confirmDialog,
    listLoading: shell.listLoading,
    isItemDragging: list.isItemDragging,
    itemDragHandlers: list.itemDragHandlers,
    sidebarDropZoneProps: list.sidebarDropZoneProps,
    selectionBarButtons: mutations.selectionBarButtons,
    selectionBar: mutations.selectionBar,
    handleSelect: list.handleSelect,
    closeMobileDetail: list.closeMobileDetail,
    enterSelectionFor: list.enterSelectionFor,
    selectView,
    hiddenNotebookIds: shell.hiddenNotebookIds,
    toggleNotebookVisibility: shell.toggleNotebookVisibility,
    setSearchQuery: shell.setSearchQuery,
    setMoveDialog: mutations.setMoveDialog,
    setEditDialog: mutations.setEditDialog,
    setDeleteDialog: mutations.setDeleteDialog,
    moveToNotebook: mutations.moveToNotebook,
    moveActiveNoteToNotebook: mutations.moveActiveNoteToNotebook,
    assignTagToNotes: mutations.assignTagToNotes,
    renameTag,
    createNote,
    noteCreatePending,
    toggleStar: mutations.toggleStar,
    toggleArchive: mutations.toggleArchive,
    requestDeleteSelected: mutations.requestDeleteSelected,
    openDeleteConfirm: mutations.openDeleteConfirm,
    renameNotebook: mutations.renameNotebook,
    toggleNoteTag: mutations.toggleNoteTag,
    addNoteTag: mutations.addNoteTag,
    updateNote: mutations.updateNote,
    applyLocalBodyMarkdown: mutations.applyLocalBodyMarkdown,
  };
}

export type NotesControllerState = ReturnType<typeof useNotesController>;
