import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { blurWorkspaceDetailEditor } from "@/hooks/blur-workspace-detail-editor";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useSelectionResetOnKeyChange } from "@/hooks/use-selection-reset-on-key-change";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import type { Note } from "@/lib/models/note";
import { isLocalTempNoteId } from "@/lib/offline/notes-offline-store";
import { filterVisibleNotes } from "./notes-note-utils";
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
    showMutationError,
  } = shell;

  const [activeId, setActiveId] = useState<string>(() => initialNoteId ?? "");
  const isTouch = useIsTouch();

  useEffect(() => {
    if (!initialNoteId) return;
    workspaceLayoutRef.current?.openMobileDetail();
  }, [initialNoteId, workspaceLayoutRef]);

  const noteSyncedRef = useRef(false);
  useEffect(() => {
    if (!noteSyncedRef.current) {
      noteSyncedRef.current = true;
      return;
    }
    // Include local-* temp ids: offline creates often keep that prefix until
    // (or after) sync, and skipping them left All/Starred selection without a
    // path update. Remap still fires onNoteChange again with the server id.
    onNoteChange?.(activeId);
  }, [activeId, onNoteChange]);

  const visibleNotes = useMemo(
    () => filterVisibleNotes(notes, { view, archived, starred, searchQuery }),
    [archived, notes, searchQuery, starred, view],
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
      setActiveId(id);
      workspaceLayoutRef.current?.openMobileDetail();
    },
    onNavigateToId: () => {
      blurWorkspaceDetailEditor();
      workspaceLayoutRef.current?.openMobileDetail();
    },
    onMutationError: showMutationError,
    queueDelayMs: WRITE_QUEUE_DELAY_MS,
  });

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

  useSelectionResetOnKeyChange({
    resetKey: view,
    setSelectedIds,
    setSelectionMode,
  });

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
    } else {
      setActiveId("");
    }
    prevNotesRef.current = notes;
  }, [activeId, notes, setSelectedIds]);

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
  };
}

export type NotesListState = ReturnType<typeof useNotesList>;
