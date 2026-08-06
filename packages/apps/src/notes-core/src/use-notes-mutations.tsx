import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { Archive, ArchiveRestore, BookOpen, Plus, Star, StarOff, Tag, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { Note } from "@/lib/models/note";
import { createTempNoteId } from "@/lib/offline/notes-offline-store";
import {
  AUTOSAVE_WRITE_DEBOUNCE_MS,
  createNoteSaveDebouncer,
  enrichNote,
  mapNotesWithBodyMarkdown,
  normalizeTag,
  noteAllowsTagAssignment,
  noteShowsStarControls,
  persistBestEffort,
  resolveNotesCreateTarget,
} from "./notes-note-utils";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { useNotesBatchActions } from "./use-notes-batch-actions";
import type { NotesListState } from "./use-notes-list";
import type { NotesShellState } from "./use-notes-shell";

export type UseNotesMutationsArgs = {
  shell: NotesShellState;
  list: NotesListState;
};

export function useNotesMutations({ shell, list }: UseNotesMutationsArgs) {
  const {
    L,
    notes,
    setNotes,
    view,
    setView,
    notebooks,
    tags,
    starred,
    applyStarToggle,
    batchToggleStarForIds,
    archived,
    setArchived,
    canCreateNote,
    operations,
    show,
    queueAutoSaveToast,
    workspaceLayoutRef,
  } = shell;

  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    exitSelection,
    selectSingle,
    queueMutation,
    setActiveId,
    beginOptimisticUpdate,
  } = list;

  const debouncerRef = useRef(createNoteSaveDebouncer(AUTOSAVE_WRITE_DEBOUNCE_MS));
  const { online } = useConnectivity();
  const wasOnlineRef = useRef(online);

  useEffect(() => {
    const debouncer = debouncerRef.current;
    return () => {
      if (operations) {
        debouncer.flushAll((note) => persistBestEffort(operations.upsertNote(note)));
      }
    };
  }, [operations]);

  useEffect(() => {
    if (wasOnlineRef.current && !online && operations) {
      debouncerRef.current.flushAll((note) => persistBestEffort(operations.upsertNote(note)));
    }
    wasOnlineRef.current = online;
  }, [online, operations]);

  const [moveDialog, setMoveDialog] = useState<{ ids: string[] } | null>(null);
  const [editDialog, setEditDialog] = useState<null | { kind: "notebook" | "tag"; name: string }>(
    null,
  );
  const [deleteDialog, setDeleteDialog] = useState<null | {
    kind: "notebook" | "tag";
    name: string;
  }>(null);

  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "notes-dialog-surface",
  });

  const updateAndPersistNote = useCallback(
    (noteId: string, updater: (note: Note) => Note, options?: { autoSaveToast?: boolean }) => {
      let updated: Note | undefined;
      setNotes((prev) =>
        prev.map((note) => {
          if (note.id !== noteId) return note;
          updated = updater(note);
          return updated;
        }),
      );
      if (updated) {
        if (options?.autoSaveToast) {
          queueAutoSaveToast();
        }
        if (operations) {
          const ops = operations;
          const persist = (note: Note) => persistBestEffort(ops.upsertNote(note));
          if (online) {
            debouncerRef.current.schedule(noteId, updated, persist);
          } else {
            persist(updated);
          }
        }
      }
    },
    [online, operations, queueAutoSaveToast, setNotes],
  );

  const toggleStar = useCallback(
    (id: string) => {
      const current = notes.find((note) => note.id === id);
      if (!current || !noteShowsStarControls(current)) return;
      const beforeStarred = !!starred[id];
      const nowStarred = applyStarToggle(id);
      setNotes((prev) =>
        prev.map((note) => (note.id === id ? { ...note, starred: nowStarred } : note)),
      );
      show(nowStarred ? "Starred" : "Unstarred", {
        icon: nowStarred ? (
          <Star className="size-4" fill="currentColor" />
        ) : (
          <StarOff className="size-4" />
        ),
      });
      if (!operations) return;
      const updated = { ...current, starred: nowStarred };
      queueMutation({
        key: `notes:star:${id}`,
        toastMessage: nowStarred ? "Starred" : "Unstarred",
        execute: () => operations.upsertNote(updated).then(() => {}),
        undo: () => {
          applyStarToggle(id);
          setNotes((prev) =>
            prev.map((note) => (note.id === id ? { ...note, starred: beforeStarred } : note)),
          );
        },
        onError: () => {
          applyStarToggle(id);
          setNotes((prev) =>
            prev.map((note) => (note.id === id ? { ...note, starred: beforeStarred } : note)),
          );
        },
        undoToastMessage: "Star change undone.",
      });
    },
    [applyStarToggle, notes, operations, queueMutation, setNotes, show, starred],
  );

  const toggleArchive = useCallback(
    (id: string) => {
      const row = notes.find((note) => note.id === id);
      if (!row) return;
      let nextArchived = false;
      const beforeArchived = !!archived[id];
      setArchived((state) => {
        nextArchived = !state[id];
        return { ...state, [id]: nextArchived };
      });
      setNotes((prev) =>
        prev.map((note) => (note.id === id ? { ...note, archived: nextArchived } : note)),
      );

      const toastMessage = nextArchived ? "Archived" : "Unarchived";

      const rollback = () => {
        setArchived((state) => ({ ...state, [id]: beforeArchived }));
        setNotes((prev) =>
          prev.map((note) => (note.id === id ? { ...row, archived: beforeArchived } : note)),
        );
      };

      queueMutation({
        key: `notes:archive:${id}`,
        toastMessage,
        execute: async (signal) => {
          if (!operations) return;
          const serverRow = nextArchived
            ? await operations.archiveNote(id, { signal })
            : await operations.restoreNote(id, { signal });
          setArchived((state) => ({ ...state, [id]: !!serverRow.archived }));
          setNotes((prev) => prev.map((note) => (note.id === id ? serverRow : note)));
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Archive change undone.",
      });
    },
    [archived, notes, operations, queueMutation, setArchived, setNotes],
  );

  const moveToNotebook = useCallback(
    (ids: string[], notebook: string) => {
      const { rollback } = beginOptimisticUpdate({
        ids,
        updater: (note) => ({ ...note, notebook }),
      });
      show(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to “${notebook}”`, {
        icon: <BookOpen className="size-4" />,
      });
      if (!operations) return;
      const updatedRows = notes
        .filter((note) => ids.includes(note.id))
        .map((note) => ({ ...note, notebook }));
      queueMutation({
        key: `notes:move:${notebook}:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to “${notebook}”`,
        execute: () =>
          Promise.all(updatedRows.map((row) => operations.upsertNote(row))).then(() => {}),
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Move undone.",
      });
    },
    [beginOptimisticUpdate, notes, operations, queueMutation, setNotes, show],
  );

  const assignTagToNotes = useCallback(
    (ids: string[], rawTag: string) => {
      const tag = normalizeTag(rawTag);
      if (!tag) return;
      const assignableIds = ids.filter((id) => {
        const note = notes.find((row) => row.id === id);
        return note ? noteAllowsTagAssignment(note, true) : false;
      });
      if (assignableIds.length === 0) return;
      const before = notes.filter((note) => assignableIds.includes(note.id));
      setNotes((prev) =>
        prev.map((note) =>
          assignableIds.includes(note.id) && !note.tags.includes(tag)
            ? { ...note, tags: [...note.tags, tag] }
            : note,
        ),
      );
      show(
        `Tagged ${assignableIds.length} item${assignableIds.length === 1 ? "" : "s"} with ${tag}`,
        {
          icon: <Tag className="size-4" />,
        },
      );
      if (!operations) return;
      const updatedRows = before.map((note) =>
        note.tags.includes(tag) ? note : { ...note, tags: [...note.tags, tag] },
      );
      queueMutation({
        key: `notes:tag:${tag}:${assignableIds.slice().sort().join(",")}`,
        toastMessage: `Tagged ${assignableIds.length} item${assignableIds.length === 1 ? "" : "s"} with ${tag}`,
        execute: () =>
          Promise.all(updatedRows.map((row) => operations.upsertNote(row))).then(() => {}),
        undo: () => {
          setNotes((prev) =>
            prev.map((note) => {
              const snapshot = before.find((row) => row.id === note.id);
              return snapshot ? snapshot : note;
            }),
          );
        },
        onError: () => {
          setNotes((prev) =>
            prev.map((note) => {
              const snapshot = before.find((row) => row.id === note.id);
              return snapshot ? snapshot : note;
            }),
          );
        },
        undoToastMessage: "Tag assignment undone.",
      });
    },
    [notes, operations, queueMutation, setNotes, show],
  );

  const renameNotebook = useCallback(
    (oldName: string, newName: string) => {
      const value = newName.trim();
      if (!value || (value !== oldName && notebooks.includes(value))) return;
      setNotes((prev) =>
        prev.map((note) => (note.notebook === oldName ? { ...note, notebook: value } : note)),
      );
      if (view === `nb:${oldName}`) setView(`nb:${value}`);
      if (operations) persistBestEffort(operations.renameNotebook(oldName, value));
      show(`Renamed to “${value}”`, { icon: <Tag className="size-4" /> });
    },
    [notebooks, operations, setNotes, setView, show, view],
  );

  const renameTag = useCallback(
    (oldName: string, newName: string) => {
      const value = normalizeTag(newName);
      if (!value || (value !== oldName && tags.includes(value))) return;
      const changedRows = notes
        .filter((note) => note.tags.includes(oldName))
        .map((note) => ({
          ...note,
          tags: note.tags.map((tag) => (tag === oldName ? value : tag)),
        }));
      setNotes((prev) =>
        prev.map((note) => ({
          ...note,
          tags: note.tags.map((tag) => (tag === oldName ? value : tag)),
        })),
      );
      if (view === `tag:${oldName}`) setView(`tag:${value}`);
      if (operations) {
        changedRows.forEach((note) => persistBestEffort(operations.upsertNote(note)));
      }
      show(`Renamed to ${value}`, { icon: <Tag className="size-4" /> });
    },
    [notes, operations, setNotes, setView, show, tags, view],
  );

  const deleteNotebook = useCallback(
    (name: string, opts: { transferTo?: string; archive?: boolean }) => {
      if (opts.transferTo) {
        const target = opts.transferTo;
        setNotes((prev) =>
          prev.map((note) => (note.notebook === name ? { ...note, notebook: target } : note)),
        );
        if (operations) {
          persistBestEffort(operations.deleteNotebook(name, { kind: "move", target }));
        }
      } else if (opts.archive) {
        const fallback = notebooks.find((notebook) => notebook !== name) ?? "";
        setArchived((state) => {
          const next = { ...state };
          notes.forEach((note) => {
            if (note.notebook === name) next[note.id] = true;
          });
          return next;
        });
        if (fallback) {
          setNotes((prev) =>
            prev.map((note) => (note.notebook === name ? { ...note, notebook: fallback } : note)),
          );
        }
        if (operations) {
          persistBestEffort(operations.deleteNotebook(name, { kind: "archive" }));
        }
      } else if (operations) {
        persistBestEffort(operations.deleteNotebook(name, { kind: "purge" }));
      }
      if (view === `nb:${name}`) setView("all");
      show(`Notebook “${name}” deleted`, { icon: <Trash2 className="size-4" /> });
    },
    [notebooks, notes, operations, setArchived, setNotes, setView, show, view],
  );

  const deleteTag = useCallback(
    (name: string) => {
      const changedRows = notes
        .filter((note) => note.tags.includes(name))
        .map((note) => ({
          ...note,
          tags: note.tags.filter((tag) => tag !== name),
        }));
      setNotes((prev) =>
        prev.map((note) => ({ ...note, tags: note.tags.filter((tag) => tag !== name) })),
      );
      if (view === `tag:${name}`) setView("all");
      if (operations) {
        changedRows.forEach((note) => persistBestEffort(operations.upsertNote(note)));
      }
      show(`Tag ${name} deleted`, { icon: <Trash2 className="size-4" /> });
    },
    [notes, operations, setNotes, setView, show, view],
  );

  const toggleNoteTag = useCallback(
    (noteId: string, rawTag: string) => {
      const tag = normalizeTag(rawTag);
      if (!tag) return;
      const before = notes.find((note) => note.id === noteId);
      if (!before || !noteAllowsTagAssignment(before, true)) return;
      const has = before.tags.includes(tag);
      const added = !has;
      const updated = {
        ...before,
        tags: has ? before.tags.filter((current) => current !== tag) : [...before.tags, tag],
      };
      setNotes((prev) => prev.map((note) => (note.id === noteId ? updated : note)));
      const toastMessage = added ? `Added ${tag}` : `Removed ${tag}`;
      const rollback = () => {
        setNotes((prev) => prev.map((note) => (note.id === noteId ? before : note)));
      };
      queueMutation({
        key: `notes:tag-toggle:${noteId}:${tag}`,
        toastMessage,
        icon: <Tag className="size-4" />,
        execute: async (signal) => {
          if (operations) await operations.upsertNote(updated, { signal });
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: added ? "Tag assignment undone." : "Tag removal undone.",
      });
    },
    [notes, operations, queueMutation, setNotes],
  );

  const updateNote = useCallback(
    (id: string, patch: Partial<Note>) => {
      // Metadata only (title/tags/notebook/starred). Body is owned by the collab
      // document and never travels through the Notes upsert path.
      updateAndPersistNote(id, (note) => ({ ...note, ...patch }), { autoSaveToast: true });
    },
    [updateAndPersistNote],
  );

  /**
   * Optimistic list/footer sync when the collab body changes. Updates local
   * body/excerpt (+ Dexie mirror) without enqueueing a metadata upsert —
   * the body still persists only through the collab document.
   *
   * Pass `bumpDate: false` when hydrating from a loaded doc so refresh/open
   * fills the list preview without rewriting “Last edited”.
   */
  const applyLocalBodyMarkdown = useCallback(
    (id: string, markdown: string, options?: { bumpDate?: boolean }) => {
      let updated: Note | undefined;
      setNotes((prev) => {
        const result = mapNotesWithBodyMarkdown(prev, id, markdown, options);
        updated = result.updated;
        return result.notes;
      });
      if (!updated) return;
      const username = readOfflineNotesUsername();
      if (username) {
        persistBestEffort(upsertNoteInCache(username, updated, false));
      }
    },
    [setNotes],
  );

  const createNote = useCallback(() => {
    if (!canCreateNote) return;
    const target = resolveNotesCreateTarget(view, notebooks);
    const targetTag = view.startsWith("tag:") ? view.slice(4) : null;
    const id = createTempNoteId();
    const date = new Date().toISOString();
    const note: Note = {
      id,
      category: L.newNoteCategory,
      date,
      updatedAt: date,
      excerpt: "",
      body: [""],
      notebook: target.notebook,
      tags: targetTag ? [normalizeTag(targetTag)] : [],
      wordCount: 0,
      ...(target.scope === "group" && target.groupSlug
        ? { scope: "group" as const, groupSlug: target.groupSlug }
        : {}),
    };
    setNotes((prev) => [note, ...prev]);
    setActiveId(id);
    selectSingle(id);
    workspaceLayoutRef.current?.openMobileDetail();
    if (operations) {
      void operations
        .upsertNote(note)
        .then((saved) => {
          if (saved.id === id) return;
          setNotes((prev) => prev.map((row) => (row.id === id ? enrichNote(saved) : row)));
          setActiveId((current) => (current === id ? saved.id : current));
          if (selectedIds.includes(id)) {
            setSelectedIds((current) => current.map((rowId) => (rowId === id ? saved.id : rowId)));
          }
        })
        .catch(() => {});
    }
    show(L.toastNewNote, { icon: <Plus className="size-4" /> });
  }, [
    L.newNoteCategory,
    L.toastNewNote,
    canCreateNote,
    notebooks,
    operations,
    selectSingle,
    selectedIds,
    setActiveId,
    setNotes,
    setSelectedIds,
    show,
    view,
    workspaceLayoutRef,
  ]);

  const { batchStar, batchArchive, requestDeleteSelected, openDeleteConfirm } =
    useNotesBatchActions({
      notes,
      setNotes,
      selectedIds,
      view,
      archived,
      setArchived,
      setSelectedIds,
      setSelectionMode,
      operations,
      queueMutation,
      batchToggleStarForIds,
      requestConfirm,
      deleteConfirmCopy: {
        dialogEmptyArchiveTitle: L.dialogEmptyArchiveTitle,
        dialogDeleteItemsTitle: L.dialogDeleteItemsTitle,
        dialogEmptyArchiveDescription: L.dialogEmptyArchiveDescription,
        dialogDeleteSelectedDescription: L.dialogDeleteSelectedDescription,
        dialogDeleteConfirmSuffix: L.dialogDeleteConfirmSuffix,
        dialogPermanentDeleteLeadIn: L.dialogPermanentDeleteLeadIn,
        dialogDelete: L.dialogDelete,
        dialogCancel: L.dialogCancel,
      },
    });

  const selectedRows = useMemo(
    () => notes.filter((note) => selectedIds.includes(note.id)),
    [notes, selectedIds],
  );
  const starableSelected = useMemo(
    () => selectedRows.filter((note) => noteShowsStarControls(note)),
    [selectedRows],
  );
  const allSelectedStarred =
    starableSelected.length > 0 && starableSelected.every((note) => !!starred[note.id]);
  const allSelectedArchived =
    selectedRows.length > 0 && selectedRows.every((note) => !!archived[note.id]);

  const selectionActionButtons = useMemo(
    () => [
      ...(starableSelected.length > 0
        ? [
            {
              label: allSelectedStarred ? L.swipeUnstar : L.selectionStar,
              icon: <Star className="size-4" fill={allSelectedStarred ? "currentColor" : "none"} />,
              onClick: batchStar,
              active: allSelectedStarred,
            },
          ]
        : []),
      {
        label: allSelectedArchived ? L.swipeUnarchive : L.selectionArchive,
        icon: allSelectedArchived ? (
          <ArchiveRestore className="size-4" />
        ) : (
          <Archive className="size-4" />
        ),
        onClick: batchArchive,
        active: allSelectedArchived,
      },
      {
        label: L.selectionMoveToNotebook,
        icon: <BookOpen className="size-4" />,
        onClick: () => setMoveDialog({ ids: selectedIds }),
      },
      ...(view === "archive"
        ? [
            {
              label: L.selectionDeletePermanently,
              icon: <Trash2 className="size-4" />,
              onClick: requestDeleteSelected,
            },
          ]
        : []),
    ],
    [
      allSelectedArchived,
      allSelectedStarred,
      batchArchive,
      batchStar,
      requestDeleteSelected,
      selectedIds,
      starableSelected.length,
      L.swipeUnstar,
      L.selectionStar,
      L.swipeUnarchive,
      L.selectionArchive,
      L.selectionMoveToNotebook,
      L.selectionDeletePermanently,
      view,
    ],
  );
  const { selectionBarButtons, selectionBar } = useWorkspaceSelectionPresentation({
    selectedIds,
    selectionMode,
    activeId: list.activeId,
    exitSelection,
    actionButtons: selectionActionButtons,
    doneLabel: L.selectionDone,
    floatingClassName: "md:hidden",
  });

  return {
    moveDialog,
    setMoveDialog,
    editDialog,
    setEditDialog,
    deleteDialog,
    setDeleteDialog,
    confirmDialog,
    toggleStar,
    toggleArchive,
    moveToNotebook,
    assignTagToNotes,
    renameNotebook,
    renameTag,
    deleteNotebook,
    deleteTag,
    toggleNoteTag,
    updateNote,
    applyLocalBodyMarkdown,
    createNote,
    requestDeleteSelected,
    openDeleteConfirm,
    selectionBarButtons,
    selectionBar,
  };
}

export type NotesMutationsState = ReturnType<typeof useNotesMutations>;
