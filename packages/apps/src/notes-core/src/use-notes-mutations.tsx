import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Notebook,
  Plus,
  Star,
  StarOff,
  Tag,
  Trash2,
} from "lucide-react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useWorkspaceSelectionPresentation } from "@/hooks/use-workspace-list-controller";
import type { Note } from "@/lib/models/note";
import { createTempNoteId, isLocalTempNoteId } from "@/lib/offline/notes-offline-store";
import {
  AUTOSAVE_WRITE_DEBOUNCE_MS,
  createNoteSaveDebouncer,
  mapNotesWithBodyMarkdown,
  mergeCreatedNotePreservingLocalOptimistic,
  normalizeTag,
  noteAllowsTagAssignment,
  noteAfterNotebookMove,
  notesViewAfterNotebookMove,
  notesViewForCreate,
  noteShowsStarControls,
  persistBestEffort,
  resolveNotesCreateTarget,
} from "./notes-note-utils";
import { sharedNotebookFilterKeys } from "./use-notes-sidebar-model";
import { noteAllowsStructureManage } from "./notes-structure-rights";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import { upsertNoteBodyPreviewInCache, upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { persistNoteKeepingSyncRace, persistNoteOrDropGone } from "./notes-persist-access";
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
    selectView,
    notebooks,
    setNotebooks,
    notebookCollections,
    tags,
    starred,
    applyStarToggle,
    batchToggleStarForIds,
    archived,
    setArchived,
    canCreateNote,
    operations,
    show,
    showMutationError,
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
    activeId,
    setActiveId,
    beginOptimisticUpdate,
    openMobileDetail,
  } = list;

  const debouncerRef = useRef(createNoteSaveDebouncer(AUTOSAVE_WRITE_DEBOUNCE_MS));
  /** local-* → server id after online create resolves (tag upserts may still be queued). */
  const noteIdRemapRef = useRef(new Map<string, string>());
  const createInFlightRef = useRef(new Map<string, Promise<unknown>>());
  const { online } = useConnectivity();
  const wasOnlineRef = useRef(online);

  const resolveNoteId = useCallback((id: string) => noteIdRemapRef.current.get(id) ?? id, []);

  const waitForInFlightCreate = useCallback(async (id: string) => {
    const pending = createInFlightRef.current.get(id);
    if (pending) await pending.catch(() => undefined);
  }, []);

  const persistOptimisticNote = useCallback(
    (note: Note, pendingSync = true): Promise<void> => {
      const username = readOfflineNotesUsername();
      if (!username) return Promise.resolve();
      const write = (async () => {
        if (isLocalTempNoteId(note.id) && resolveNoteId(note.id) !== note.id) return;
        await upsertNoteInCache(username, note, pendingSync);
      })();
      persistBestEffort(write);
      return write;
    },
    [resolveNoteId],
  );

  const dropGoneNote = useCallback(
    (noteId: string) => {
      setNotes((prev) => prev.filter((note) => note.id !== noteId));
      setArchived((state) => {
        if (!(noteId in state)) return state;
        const next = { ...state };
        delete next[noteId];
        return next;
      });
      setSelectedIds((prev) => prev.filter((id) => id !== noteId));
      setActiveId((current) => (current === noteId ? "" : current));
    },
    [setActiveId, setArchived, setNotes, setSelectedIds],
  );

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
        persistOptimisticNote(updated, true);
        if (operations) {
          const ops = operations;
          const persist = (note: Note) => {
            persistBestEffort(
              waitForInFlightCreate(note.id).then(() => {
                const persistId = resolveNoteId(note.id);
                return ops.upsertNote({ ...note, id: persistId }).then((saved) => {
                  setNotes((prev) =>
                    prev.map((row) =>
                      row.id === persistId || row.id === note.id
                        ? mergeCreatedNotePreservingLocalOptimistic(saved, {
                            ...row,
                            id: saved.id,
                          })
                        : row,
                    ),
                  );
                  if (saved.id !== persistId) {
                    noteIdRemapRef.current.set(persistId, saved.id);
                    setActiveId((current) => (current === persistId ? saved.id : current));
                    setSelectedIds((current) =>
                      current.map((rowId) => (rowId === persistId ? saved.id : rowId)),
                    );
                  }
                });
              }),
              () => dropGoneNote(resolveNoteId(note.id)),
              resolveNoteId(note.id),
            );
          };
          if (online) {
            debouncerRef.current.schedule(noteId, updated, persist);
          } else {
            persist(updated);
          }
        }
      }
    },
    [
      dropGoneNote,
      online,
      operations,
      persistOptimisticNote,
      queueAutoSaveToast,
      resolveNoteId,
      waitForInFlightCreate,
      setActiveId,
      setNotes,
      setSelectedIds,
    ],
  );

  const toggleStar = useCallback(
    (id: string) => {
      const current = notes.find((note) => note.id === id);
      if (!current || !noteShowsStarControls(current)) return;
      const beforeStarred = !!starred[id];
      const nowStarred = applyStarToggle(id);
      const starredNote = { ...current, starred: nowStarred };
      setNotes((prev) => prev.map((note) => (note.id === id ? starredNote : note)));
      persistOptimisticNote(starredNote, true);
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
        execute: async () => {
          await persistNoteOrDropGone(operations.upsertNote(updated), () => dropGoneNote(id));
        },
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
    [
      applyStarToggle,
      dropGoneNote,
      notes,
      operations,
      persistOptimisticNote,
      queueMutation,
      setNotes,
      show,
      starred,
    ],
  );

  const toggleArchive = useCallback(
    (id: string) => {
      const row = notes.find((note) => note.id === id);
      if (!row) return;
      const beforeArchived = !!archived[id] || !!row.archived;
      const nextArchived = !beforeArchived;
      setArchived((state) => ({ ...state, [id]: nextArchived }));
      const archivedNote = { ...row, archived: nextArchived };
      setNotes((prev) => prev.map((note) => (note.id === id ? archivedNote : note)));
      persistOptimisticNote(archivedNote, true);
      // Stay on the open note. Do not use beginOptimisticUpdate / selectView —
      // those treat archive as a list-remove and clear the detail pane.
      setActiveId(id);
      selectSingle(id);

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
          const serverRow = await persistNoteOrDropGone(
            nextArchived
              ? operations.archiveNote(id, { signal })
              : operations.restoreNote(id, { signal }),
            () => dropGoneNote(id),
          );
          if (!serverRow) return;
          const archivedFlag = !!serverRow.archived;
          setArchived((state) => ({ ...state, [id]: archivedFlag }));
          setNotes((prev) =>
            prev.map((note) =>
              note.id === id
                ? {
                    ...note,
                    archived: archivedFlag,
                    ...(serverRow.etag ? { etag: serverRow.etag } : {}),
                  }
                : note,
            ),
          );
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Archive change undone.",
      });
    },
    [
      archived,
      dropGoneNote,
      notes,
      operations,
      persistOptimisticNote,
      queueMutation,
      selectSingle,
      setActiveId,
      setArchived,
      setNotes,
    ],
  );

  const moveToNotebook = useCallback(
    (ids: string[], notebook: string) => {
      const dest = notebookCollections.find((item) => item.id === notebook) ??
        notebookCollections.find((item) => item.name === notebook) ?? {
          id: notebook,
          name: notebook,
        };
      const { rollback } = beginOptimisticUpdate({
        ids,
        updater: (note) => noteAfterNotebookMove(note, dest),
      });
      // Move is not a list-remove: keep the open note selected. beginOptimisticUpdate
      // otherwise advances activeId as if the rows left the current filter.
      const followId = activeId && ids.includes(activeId) ? activeId : "";
      if (followId) {
        setActiveId(followId);
        selectSingle(followId);
        const sample = notes.find((note) => note.id === followId);
        if (sample) {
          const moved = noteAfterNotebookMove(sample, dest);
          const nextView = notesViewAfterNotebookMove(view, dest, moved, {
            archived,
            starred,
            sharedNotebookKeys: sharedNotebookFilterKeys(notebookCollections),
            notebookCollections,
          });
          if (nextView !== view) setView(nextView);
        }
      }
      setNotebooks((prev) => (prev.includes(dest.name) ? prev : [...prev, dest.name]));
      show(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to “${dest.name}”`, {
        icon: <BookOpen className="size-4" />,
      });
      if (!operations) return;
      const updatedRows = notes
        .filter((note) => ids.includes(note.id))
        .map((note) => noteAfterNotebookMove(note, dest));
      updatedRows.forEach((row) => persistOptimisticNote(row, true));
      queueMutation({
        key: `notes:move:${dest.id}:${ids.slice().sort().join(",")}`,
        toastMessage: `Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to “${dest.name}”`,
        execute: () =>
          Promise.all(
            updatedRows.map((row) =>
              persistNoteOrDropGone(operations.upsertNote(row), () => dropGoneNote(row.id)),
            ),
          ).then(() => {}),
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Move undone.",
      });
    },
    [
      activeId,
      archived,
      beginOptimisticUpdate,
      dropGoneNote,
      notebookCollections,
      notes,
      operations,
      persistOptimisticNote,
      queueMutation,
      selectSingle,
      setActiveId,
      setNotebooks,
      setView,
      show,
      starred,
      view,
    ],
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
      const editedAt = new Date().toISOString();
      setNotes((prev) =>
        prev.map((note) =>
          assignableIds.includes(note.id) && !note.tags.includes(tag)
            ? { ...note, tags: [...note.tags, tag], date: editedAt }
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
        note.tags.includes(tag) ? note : { ...note, tags: [...note.tags, tag], date: editedAt },
      );
      updatedRows.forEach((row) => persistOptimisticNote(row, true));
      queueMutation({
        key: `notes:tag:${tag}:${assignableIds.slice().sort().join(",")}`,
        toastMessage: `Tagged ${assignableIds.length} item${assignableIds.length === 1 ? "" : "s"} with ${tag}`,
        execute: () =>
          Promise.all(
            updatedRows.map(async (row) => {
              await waitForInFlightCreate(row.id);
              const persistId = resolveNoteId(row.id);
              return persistNoteKeepingSyncRace(
                operations.upsertNote({ ...row, id: persistId }),
                () => dropGoneNote(row.id),
                persistId,
              );
            }),
          ).then(() => {}),
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
    [
      dropGoneNote,
      notes,
      operations,
      persistOptimisticNote,
      queueMutation,
      resolveNoteId,
      setNotes,
      show,
      waitForInFlightCreate,
    ],
  );

  const renameNotebook = useCallback(
    (oldName: string, newName: string) => {
      const value = newName.trim();
      if (!value || (value !== oldName && notebooks.includes(value))) return;
      setNotes((prev) =>
        prev.map((note) => (note.notebook === oldName ? { ...note, notebook: value } : note)),
      );
      setNotebooks((prev) => [
        ...new Set(prev.map((notebook) => (notebook === oldName ? value : notebook))),
      ]);
      if (view === `nb:${oldName}`) setView(`nb:${value}`);
      if (operations) persistBestEffort(operations.renameNotebook(oldName, value));
      show(`Renamed to “${value}”`, { icon: <Tag className="size-4" /> });
    },
    [notebooks, operations, setNotebooks, setNotes, setView, show, view],
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
        changedRows.forEach((note) =>
          persistBestEffort(operations.upsertNote(note), () => dropGoneNote(note.id), note.id),
        );
      }
      show(`Renamed to ${value}`, { icon: <Tag className="size-4" /> });
    },
    [dropGoneNote, notes, operations, setNotes, setView, show, tags, view],
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
      // Drop from sidebar even when empty / Dexie-only (API omits empty personal dirs).
      setNotebooks((prev) => prev.filter((notebook) => notebook !== name));
      if (view === `nb:${name}`) setView("all");
      show(L.toastNotebookDeleted(name), { icon: <Trash2 className="size-4" /> });
    },
    [
      L.toastNotebookDeleted,
      notebooks,
      notes,
      operations,
      setArchived,
      setNotebooks,
      setNotes,
      setView,
      show,
      view,
    ],
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
        changedRows.forEach((note) =>
          persistBestEffort(operations.upsertNote(note), () => dropGoneNote(note.id), note.id),
        );
      }
      show(`Tag ${name} deleted`, { icon: <Trash2 className="size-4" /> });
    },
    [dropGoneNote, notes, operations, setNotes, setView, show, view],
  );

  const toggleNoteTag = useCallback(
    (noteId: string, rawTag: string) => {
      const tag = normalizeTag(rawTag);
      if (!tag) return;
      const before = notes.find((note) => note.id === noteId);
      if (!before || !noteAllowsTagAssignment(before, true)) return;
      const has = before.tags.includes(tag);
      const added = !has;
      const editedAt = new Date().toISOString();
      const updated = {
        ...before,
        tags: has ? before.tags.filter((current) => current !== tag) : [...before.tags, tag],
        date: editedAt,
      };
      setNotes((prev) => prev.map((note) => (note.id === noteId ? updated : note)));
      persistOptimisticNote(updated, true);
      const toastMessage = added ? `Added ${tag}` : `Removed ${tag}`;
      const rollback = () => {
        setNotes((prev) => prev.map((note) => (note.id === noteId ? before : note)));
      };
      queueMutation({
        key: `notes:tag-toggle:${noteId}:${tag}`,
        toastMessage,
        icon: <Tag className="size-4" />,
        execute: async (signal) => {
          if (operations) {
            await waitForInFlightCreate(noteId);
            const persistId = resolveNoteId(noteId);
            await persistNoteKeepingSyncRace(
              operations.upsertNote({ ...updated, id: persistId }, { signal }),
              () => dropGoneNote(noteId),
              persistId,
            );
          }
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: added ? "Tag assignment undone." : "Tag removal undone.",
      });
    },
    [
      dropGoneNote,
      notes,
      operations,
      persistOptimisticNote,
      queueMutation,
      resolveNoteId,
      setNotes,
      waitForInFlightCreate,
    ],
  );

  const updateNote = useCallback(
    (id: string, patch: Partial<Note>) => {
      // Metadata only (title/tags/notebook/starred). Body is owned by the collab
      // document and never travels through the Notes upsert path.
      updateAndPersistNote(
        id,
        (note) => ({
          ...note,
          ...patch,
          ...(patch.title !== undefined ? { date: new Date().toISOString() } : {}),
        }),
        { autoSaveToast: true },
      );
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
      const persistId = resolveNoteId(id);
      setNotes((prev) => {
        const lookupId = prev.some((note) => note.id === persistId) ? persistId : id;
        const result = mapNotesWithBodyMarkdown(prev, lookupId, markdown, options);
        if (!result.updated) return prev;
        // Persist inside the updater so a deferred setState cannot skip Dexie.
        const username = readOfflineNotesUsername();
        if (username) {
          persistBestEffort(
            upsertNoteBodyPreviewInCache(username, { ...result.updated, id: persistId }),
          );
        }
        return result.notes;
      });
    },
    [resolveNoteId, setNotes],
  );

  const createNote = useCallback(() => {
    if (!canCreateNote) return;
    const createView = notesViewForCreate(view);
    if (createView !== view) {
      selectView(createView);
    }
    const target = resolveNotesCreateTarget(createView, notebooks);
    const targetTag = createView.startsWith("tag:") ? createView.slice(4) : null;
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
    selectSingle(id);
    openMobileDetail(id);
    // Persist immediately. Leaving the detail pane without a body (or title)
    // must not DELETE — empty DESCRIPTION is a valid VJOURNAL.
    if (operations) {
      void persistOptimisticNote(note, true);
      const persist = operations.upsertNote(note).then((saved) => {
        if (saved.id !== id) {
          noteIdRemapRef.current.set(id, saved.id);
          debouncerRef.current.remapId(id, saved.id);
          setNotes((prev) =>
            prev.map((row) =>
              row.id === id ? mergeCreatedNotePreservingLocalOptimistic(saved, row) : row,
            ),
          );
          setActiveId((current) => (current === id ? saved.id : current));
          setSelectedIds((current) =>
            current.some((rowId) => rowId === id)
              ? current.map((rowId) => (rowId === id ? saved.id : rowId))
              : current,
          );
        }
        if (isLocalTempNoteId(saved.id)) {
          showMutationError(L.syncFailedMessage);
          return saved;
        }
        persistOptimisticNote(saved, false);
        return saved;
      });
      createInFlightRef.current.set(id, persist);
      void persist
        .catch(() => {
          showMutationError(L.syncFailedMessage);
        })
        .finally(() => {
          createInFlightRef.current.delete(id);
        });
    }
    show(L.toastNewNote, { icon: <Plus className="size-4" /> });
  }, [
    L.newNoteCategory,
    L.syncFailedMessage,
    L.toastNewNote,
    canCreateNote,
    notebooks,
    operations,
    persistOptimisticNote,
    selectSingle,
    showMutationError,
    selectView,
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
      dropGoneNote,
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
  const allSelectedAllowStructure =
    selectedRows.length > 0 && selectedRows.every((note) => noteAllowsStructureManage(note));
  const showSelectionArchive = allSelectedAllowStructure;
  const showSelectionDelete = allSelectedAllowStructure && view === "archive";

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
      ...(showSelectionArchive
        ? [
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
          ]
        : []),
      {
        label: L.selectionMoveToNotebook,
        icon: <Notebook className="size-4" />,
        onClick: () => setMoveDialog({ ids: selectedIds }),
      },
      ...(showSelectionDelete
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
      showSelectionArchive,
      showSelectionDelete,
      starableSelected.length,
      L.swipeUnstar,
      L.selectionStar,
      L.swipeUnarchive,
      L.selectionArchive,
      L.selectionMoveToNotebook,
      L.selectionDeletePermanently,
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
