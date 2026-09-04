import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { blurWorkspaceDetailEditor } from "@/hooks/blur-workspace-detail-editor";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import type { Note } from "@/lib/models/note";
import { afterViewTransition } from "@/lib/view-transition";
import { isLocalTempNoteId } from "@/lib/offline/notes-offline-store";
import {
  filterNotesByHiddenNotebooks,
  filterVisibleNotes,
  mergeCreatedNotePreservingLocalOptimistic,
} from "./notes-note-utils";
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

  const prevNotesRef = useRef(notes);

  useEffect(() => {
    if (!activeId) {
      prevNotesRef.current = notes;
      return;
    }
    if (notes.some((note) => note.id === activeId)) {
      prevNotesRef.current = notes;
      return;
    }

    const prevNotes = prevNotesRef.current;
    const prevActive = prevNotes.find((note) => note.id === activeId);
    let remappedId: string | undefined;

    if (isLocalTempNoteId(activeId)) {
      const prevIds = new Set(prevNotes.map((note) => note.id));
      const added = notes.filter((note) => !prevIds.has(note.id));
      if (added.length === 1) {
        remappedId = added[0]?.id;
      } else if (prevActive) {
        remappedId = notes.find(
          (note) =>
            note.notebook === prevActive.notebook &&
            note.date === prevActive.date &&
            note.excerpt === prevActive.excerpt &&
            note.body.join("\n\n") === prevActive.body.join("\n\n"),
        )?.id;
      }
    }

    if (remappedId) {
      setActiveId(remappedId);
      setSelectedIds((current) =>
        current.map((rowId) => (rowId === activeId ? remappedId! : rowId)),
      );
      // Bootstrap/outbox remap drops the local-* row; copy optimistic tags onto
      // the server id before the write-queue tag upsert lands.
      if (prevActive) {
        const from = prevActive;
        setNotes((current) =>
          current.map((note) =>
            note.id === remappedId
              ? mergeCreatedNotePreservingLocalOptimistic(note, { ...from, id: remappedId! })
              : note,
          ),
        );
      }
    } else {
      setActiveId("");
    }
    prevNotesRef.current = notes;
  }, [activeId, notes, setNotes, setSelectedIds]);

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
