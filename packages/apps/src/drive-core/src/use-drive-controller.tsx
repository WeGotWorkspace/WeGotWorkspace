import { useEffect, useRef } from "react";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import { isKeyboardFieldTarget } from "@/lib/keyboard/is-keyboard-field-target";
import type { ViewKey } from "@/lib/files/drive-models";
import type {
  DriveAPIOperations,
  DriveShareOperations,
  DriveUIData,
} from "@/lib/files/drive-types";
import { driveParentFolderPath } from "@/drive-core/src/drive-breadcrumbs";
import { useDriveList } from "@/drive-core/src/use-drive-list";
import { useDriveMutations } from "@/drive-core/src/use-drive-mutations";
import { useDriveShell } from "@/drive-core/src/use-drive-shell";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

export type UseDriveControllerArgs = {
  data: DriveUIData;
  session: WorkspaceSession;
  operations?: DriveAPIOperations;
  shareOperations?: DriveShareOperations;
  listLoading?: boolean;
  view?: ViewKey;
  onViewChange?: (view: ViewKey) => void;
  onOpenDocsFile?: (apiPath: string) => void;
};

/**
 * Drive workspace controller: composes shell navigation, list/selection, and mutation slices.
 * See useDriveShell, useDriveList, and useDriveMutations for domain-specific state.
 */
export function useDriveController({
  data,
  session,
  operations,
  shareOperations,
  listLoading = false,
  view,
  onViewChange,
  onOpenDocsFile,
}: UseDriveControllerArgs) {
  const shell = useDriveShell({
    data,
    session,
    operations,
    shareOperations,
    listLoading,
    view,
    onViewChange,
  });
  const list = useDriveList({ shell, onOpenDocsFile });
  const mutations = useDriveMutations({ shell, list, onOpenDocsFile });
  const resetRenameRef = useRef(mutations.resetRenameDialog);
  resetRenameRef.current = mutations.resetRenameDialog;

  useEffect(() => {
    resetRenameRef.current();
  }, [shell.viewResetKey]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inField = isKeyboardFieldTarget(e.target);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (!inField && e.key === "/")) {
        e.preventDefault();
        shell.searchInputRef.current?.focus();
        shell.searchInputRef.current?.select();
        return;
      }
      if (inField) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        const opening = !list.detailOpen;
        if (opening && !list.active) {
          const focusId = list.activeId ?? list.selectedIds[0];
          if (focusId) {
            list.setActiveId(focusId);
          }
        }
        list.setDetailOpen(opening);
        return;
      }
      if (e.key === "Escape" && list.detailOpen) {
        list.setDetailOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    list.active,
    list.activeId,
    list.detailOpen,
    list.selectedIds,
    list.setActiveId,
    list.setDetailOpen,
    shell.searchInputRef,
  ]);

  useWorkspaceListKeyboardShortcuts({
    searchInputRef: shell.searchInputRef,
    selectedCount: list.selectedIds.length,
    onRequestDeleteSelection: mutations.requestDeleteSelected,
    onNavigateList: list.navigateListByKeyboard,
    onUndoQueuedAction: list.undoLatest,
    onOpenActive: (focusedId) => {
      const item = focusedId ? list.fileById(focusedId) : list.active;
      if (item && (focusedId || list.selectedIds.length <= 1)) list.openFile(item);
    },
    onRenameActive: (focusedId) => {
      const item = focusedId ? list.fileById(focusedId) : list.active;
      if (item && (focusedId || list.selectedIds.length <= 1) && !mutations.renameDialog) {
        mutations.requestRenameItem(item);
      }
    },
    onNavigateUp: () => {
      const parent = driveParentFolderPath(shell.view);
      if (parent) shell.selectView({ type: "folder", path: parent });
    },
  });

  return {
    labels: shell.labels,
    currentUsername: shell.currentUsername,
    files: shell.files,
    setFiles: shell.setFiles,
    view: shell.view,
    setView: shell.setView,
    activeId: list.activeId,
    setActiveId: list.setActiveId,
    selectedIds: list.selectedIds,
    setSelectedIds: list.setSelectedIds,
    starred: shell.starred,
    setStarred: shell.setStarred,
    sidebarOpen: shell.sidebarOpen,
    setSidebarOpen: shell.setSidebarOpen,
    detailOpen: list.detailOpen,
    setDetailOpen: list.setDetailOpen,
    selectionMode: list.selectionMode,
    setSelectionMode: list.setSelectionMode,
    viewMode: list.viewMode,
    setViewMode: list.setViewMode,
    newFolderDialogOpen: mutations.newFolderDialogOpen,
    setNewFolderDialogOpen: mutations.setNewFolderDialogOpen,
    renameDialog: mutations.renameDialog,
    setRenameDialog: mutations.setRenameDialog,
    renameName: mutations.renameName,
    setRenameName: mutations.setRenameName,
    confirmDelete: mutations.confirmDelete,
    setConfirmDelete: mutations.setConfirmDelete,
    moveDialog: mutations.moveDialog,
    setMoveDialog: mutations.setMoveDialog,
    markdownDialogOpen: mutations.markdownDialogOpen,
    markdownDialogDefaults: mutations.markdownDialogDefaults,
    markdownDialogSubmitting: mutations.markdownDialogSubmitting,
    markdownDialogError: mutations.markdownDialogError,
    closeMarkdownDialog: mutations.closeMarkdownDialog,
    submitCreateMarkdown: mutations.submitCreateMarkdown,
    searchQuery: shell.searchQuery,
    setSearchQuery: shell.setSearchQuery,
    liveSearchResults: shell.liveSearchResults,
    starredItems: shell.starredItems,
    knownGroupRoots: shell.knownGroupRoots,
    filePreviews: list.filePreviews,
    richPreviews: list.richPreviews,
    setTilesInView: list.setTilesInView,
    dropUploadActive: mutations.dropUploadActive,
    setDropUploadActive: mutations.setDropUploadActive,
    uploadEnabled: mutations.uploadEnabled,
    structureEnabled: mutations.structureEnabled,
    fileInputRef: mutations.fileInputRef,
    searchInputRef: shell.searchInputRef,
    isTouch: list.isTouch,
    inTrashView: shell.inTrashView,
    isUnderTrash: shell.isUnderTrash,
    visibleItems: list.visibleItems,
    listSort: list.listSort,
    toggleListSort: list.toggleListSort,
    folderListingPending: shell.folderListingPending,
    folderListingError: shell.folderListingError,
    retryFolderListing: shell.retryFolderListing,
    allLoading: shell.allLoading,
    allHasMore: shell.allHasMore,
    allLoadingMore: shell.allLoadingMore,
    loadMoreAll: shell.loadMoreAll,
    breadcrumbs: shell.breadcrumbs,
    viewLabel: shell.viewLabel,
    viewResetKey: shell.viewResetKey,
    active: list.active,
    groupRootNames: shell.groupRootNames,
    sidebarGroupPaths: shell.sidebarGroupPaths,
    sidebarGroupRoots: shell.sidebarGroupRoots,
    folderPickerRootLabels: shell.folderPickerRootLabels,
    openFile: list.openFile,
    openDocsEditorFile: list.openDocsEditorFile,
    handleSelect: list.handleSelect,
    enterSelectionFor: list.enterSelectionFor,
    exitSelection: list.exitSelection,
    fileById: list.fileById,
    toggleStar: mutations.toggleStar,
    batchStar: mutations.batchStar,
    moveToTrash: mutations.moveToTrash,
    moveToFolder: mutations.moveToFolder,
    commitMoveToFolder: mutations.commitMoveToFolder,
    isItemDragging: list.isItemDragging,
    itemDragHandlers: mutations.itemDragHandlers,
    sidebarDropZoneProps: list.sidebarDropZoneProps,
    folderDropZoneProps: mutations.folderDropZoneProps,
    selectionBar: mutations.selectionBar,
    selectionBarButtons: mutations.selectionBarButtons,
    requestDeleteSelected: mutations.requestDeleteSelected,
    requestDeleteItem: mutations.requestDeleteItem,
    requestMoveSelected: mutations.requestMoveSelected,
    requestMoveItem: mutations.requestMoveItem,
    openMoveDialog: mutations.openMoveDialog,
    requestRenameItem: mutations.requestRenameItem,
    submitRenameItem: mutations.submitRenameItem,
    reallyDelete: mutations.reallyDelete,
    ...mutations.uploadAction,
    createFolder: mutations.createFolder,
    submitCreateFolder: mutations.submitCreateFolder,
    createMarkdown: mutations.createMarkdown,
    selectView: shell.selectView,
    listLoading: shell.listLoading,
    operations: shell.operations,
  };
}

export type DriveControllerState = ReturnType<typeof useDriveController>;
