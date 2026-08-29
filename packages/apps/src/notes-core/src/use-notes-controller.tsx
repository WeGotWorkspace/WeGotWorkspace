import { useCallback } from "react";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import type { NotesUILabels } from "./notes-labels";
import type { NotesAPIOperations, NotesUIData } from "./notes-types";
import { useNotesList } from "./use-notes-list";
import { useNotesMutations } from "./use-notes-mutations";
import { useNotesNotebookMutations } from "./use-notes-notebook-mutations";
import { useNotesShell } from "./use-notes-shell";

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
  const list = useNotesList({ shell, initialNoteId, onNoteChange });

  const selectView = useCallback(
    (nextView: string) => {
      list.setActiveId("");
      shell.selectView(nextView);
    },
    [list, shell],
  );
  const mutations = useNotesMutations({ shell, list });
  const notebookMutations = useNotesNotebookMutations({ shell });

  useWorkspaceListKeyboardShortcuts({
    searchInputRef: shell.searchInputRef,
    selectedCount: list.selectedIds.length,
    selectionMode: list.selectionMode,
    onRequestDeleteSelection: mutations.requestDeleteSelected,
    onNavigateList: list.navigateListByKeyboard,
    onUndoQueuedAction: list.undoLatest,
  });

  return {
    L: shell.L,
    notes: shell.notes,
    setNotes: shell.setNotes,
    notebooks: shell.notebooks,
    sharedNotebooks: shell.sharedNotebooks,
    notebookCollections: shell.notebookCollections,
    groups: shell.groups,
    canManageNotebooks: notebookMutations.canManageNotebooks,
    notebookDialog: notebookMutations.notebookDialog,
    setNotebookDialog: notebookMutations.setNotebookDialog,
    openCreateNotebookDialog: notebookMutations.openCreateNotebookDialog,
    openEditNotebookDialog: notebookMutations.openEditNotebookDialog,
    createNotebookCollection: notebookMutations.createNotebook,
    updateNotebookCollection: notebookMutations.updateNotebook,
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
    canCreateNote: shell.canCreateNote,
    selectedNotebook: shell.selectedNotebook,
    selectedTag: shell.selectedTag,
    canEditDelete: shell.canEditDelete,
    searchQuery: shell.searchQuery,
    searchInputRef: shell.searchInputRef,
    moveDialog: mutations.moveDialog,
    editDialog: mutations.editDialog,
    deleteDialog: mutations.deleteDialog,
    visibleNotes: list.visibleNotes,
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
    enterSelectionFor: list.enterSelectionFor,
    selectView,
    hiddenNotebookIds: shell.hiddenNotebookIds,
    toggleNotebookVisibility: shell.toggleNotebookVisibility,
    setSearchQuery: shell.setSearchQuery,
    setMoveDialog: mutations.setMoveDialog,
    setEditDialog: mutations.setEditDialog,
    setDeleteDialog: mutations.setDeleteDialog,
    moveToNotebook: mutations.moveToNotebook,
    assignTagToNotes: mutations.assignTagToNotes,
    createNote: mutations.createNote,
    toggleStar: mutations.toggleStar,
    toggleArchive: mutations.toggleArchive,
    requestDeleteSelected: mutations.requestDeleteSelected,
    openDeleteConfirm: mutations.openDeleteConfirm,
    renameNotebook: mutations.renameNotebook,
    renameTag: mutations.renameTag,
    deleteNotebook: mutations.deleteNotebook,
    deleteTag: mutations.deleteTag,
    toggleNoteTag: mutations.toggleNoteTag,
    updateNote: mutations.updateNote,
    applyLocalBodyMarkdown: mutations.applyLocalBodyMarkdown,
  };
}

export type NotesControllerState = ReturnType<typeof useNotesController>;
