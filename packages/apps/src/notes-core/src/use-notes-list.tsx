import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { blurWorkspaceDetailEditor } from "@/hooks/blur-workspace-detail-editor";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import type { Note } from "@/lib/models/note";
import { afterViewTransition } from "@/lib/view-transition";
import { filterNotesByHiddenNotebooks, filterVisibleNotes } from "./notes-note-utils";
import { sharedNotebookFilterKeys } from "./use-notes-sidebar-model";
import type { NotesShellState } from "./use-notes-shell";

const WRITE_QUEUE_DELAY_MS = 2500;

export type UseNotesListArgs = {
  shell: NotesShellState;
  initialNoteId?: string;
  onNoteChange?: (noteId: string) => void;
};

export function useNotesList({ shell, initialNoteId, onNoteChange }: UseNotesListArgs) {
  const {
    notes,
    setNotes,
    view,
    searchQuery,
    workspaceLayoutRef,
    starred,
    archived,
    hiddenNotebookIds,
    notebookCollections,
    listLoading,
    data,
    showMutationError,
  } = shell;

  const [activeId, setActiveId] = useState<string>(() => initialNoteId ?? "");
  const isTouch = useIsTouch();
  const lastNotifiedNoteRef = useRef<string | null>(null);

  const notifyNoteChange = useCallback(
    (noteId: string) => {
      if (lastNotifiedNoteRef.current === noteId) return;
      lastNotifiedNoteRef.current = noteId;
      // History writes inside startViewTransition are dropped on iOS / Chrome,
      // so wait until the overlay snapshot callback finishes.
      afterViewTransition(() => {
        onNoteChange?.(noteId);
      });
    },
    [onNoteChange],
  );

  const openMobileDetail = useCallback(
    (noteId?: string) => {
      const during =
        noteId === undefined
          ? undefined
          : () => {
              setActiveId(noteId);
              notifyNoteChange(noteId);
            };
      const handle = workspaceLayoutRef.current;
      if (handle) {
        handle.openMobileDetail(during);
        return;
      }
      void during?.();
    },
    [notifyNoteChange, workspaceLayoutRef],
  );

  useEffect(() => {
    if (!initialNoteId) return;
    workspaceLayoutRef.current?.openMobileDetail();
  }, [initialNoteId, workspaceLayoutRef]);

  const noteSyncedRef = useRef(false);
  useEffect(() => {
    if (!noteSyncedRef.current) {
      noteSyncedRef.current = true;
      lastNotifiedNoteRef.current = activeId;
      return;
    }
    // Include local-* temp ids: offline creates often keep that prefix until
    // (or after) sync, and skipping them left All/Starred selection without a
    // path update. Remap still fires onNoteChange again with the server id.
    notifyNoteChange(activeId);
  }, [activeId, notifyNoteChange]);

  const sharedNotebookKeys = useMemo(
    () => sharedNotebookFilterKeys(notebookCollections),
    [notebookCollections],
  );

  const visibleNotes = useMemo(
    () =>
      filterNotesByHiddenNotebooks(
        filterVisibleNotes(notes, {
          view,
          archived,
          starred,
          searchQuery,
          sharedNotebookKeys,
          notebookCollections,
        }),
        view,
        hiddenNotebookIds,
      ),
    [
      archived,
      hiddenNotebookIds,
      notebookCollections,
      notes,
      searchQuery,
      sharedNotebookKeys,
      starred,
      view,
    ],
  );

  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    selectSingle,
    beginOptimisticUpdate,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
  } = useWorkspaceListController<Note>({
    items: notes,
    setItems: setNotes,
    visibleIds: visibleNotes.map((n) => n.id),
    activeId,
    setActiveId,
    initialId: initialNoteId,
    onPrimarySelect: (id) => {
      blurWorkspaceDetailEditor();
      openMobileDetail(id);
    },
    onNavigateToId: () => {
      blurWorkspaceDetailEditor();
      openMobileDetail();
    },
    onMutationError: showMutationError,
    queueDelayMs: WRITE_QUEUE_DELAY_MS,
  });

  const closeMobileDetail = useCallback(() => {
    const during = () => {
      setActiveId("");
      setSelectedIds([]);
      setSelectionMode(false);
      notifyNoteChange("");
    };
    const handle = workspaceLayoutRef.current;
    if (handle) {
      handle.closeMobileDetail(during);
      return;
    }
    void during();
  }, [notifyNoteChange, setSelectedIds, setSelectionMode, workspaceLayoutRef]);

  // URL / deep-link changes update activeId — keep selectedIds aligned so
  // isActive and isSelected never paint two different rows in single-select UI.
  useEffect(() => {
    if (initialNoteId === undefined) return;
    setActiveId(initialNoteId);
    if (initialNoteId) {
      selectSingle(initialNoteId);
    } else {
      setSelectedIds([]);
      setSelectionMode(false);
    }
  }, [initialNoteId, selectSingle, setActiveId, setSelectedIds, setSelectionMode]);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Sidebar selectView clears activeId first, so this still resets to empty.
  // Notebook move keeps activeId so the same note stays selected after the
  // destination view (and URL) catch up.
  useEffect(() => {
    const id = activeIdRef.current;
    if (id) {
      selectSingle(id);
      setSelectionMode(false);
    } else {
      setSelectedIds([]);
      setSelectionMode(false);
    }
  }, [selectSingle, setSelectedIds, setSelectionMode, view]);

  useEffect(() => {
    if (!activeId) return;
    // Prefer in-memory rows, but also trust the latest bootstrap payload.
    // Shell merges `data.notes` in an effect, so the first ready paint after
    // `listLoading` flips can still have empty local `notes` for one frame.
    if (
      notes.some((note) => note.id === activeId) ||
      data.notes.some((note) => note.id === activeId)
    ) {
      return;
    }
    // Deep link / refresh: WorkspaceLiveAppShell mounts with empty placeholder
    // notes while hybrid IndexedDB + network bootstrap runs (`listLoading`).
    // Clearing activeId here would replace `/notes/all/:noteId` → `/all` before
    // local-first cache can hydrate the row.
    if (listLoading) return;
    // A note keeps its id for life (the app picks it), so a missing active
    // note was deleted, not renamed.
    setActiveId("");
  }, [activeId, data.notes, listLoading, notes]);

  const active = activeId ? notes.find((n) => n.id === activeId) : undefined;

  return {
    activeId,
    setActiveId,
    active,
    visibleNotes,
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect: handleSelect as (id: string, e: ReactMouseEvent) => void,
    enterSelectionFor,
    exitSelection,
    selectSingle,
    isTouch,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
    beginOptimisticUpdate,
    openMobileDetail,
    closeMobileDetail,
  };
}

export type NotesListState = ReturnType<typeof useNotesList>;
