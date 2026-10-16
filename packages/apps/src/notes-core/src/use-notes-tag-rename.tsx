import { useCallback } from "react";
import { Tag } from "lucide-react";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import type { Note } from "@/lib/models/note";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { persistBestEffort } from "@/notes-core/src/notes-note-utils";
import { persistNoteKeepingSyncRace } from "@/notes-core/src/notes-persist-access";
import { noteTagsAfterRename, planNoteTagRename } from "@/notes-core/src/note-tag-rename";
import type { NotesListState } from "@/notes-core/src/use-notes-list";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";

type QueueMutation = (args: DeferredApiWriteArgs) => void;

export type UseNotesTagRenameArgs = {
  shell: NotesShellState;
  queueMutation: QueueMutation;
  persistOptimisticNote: (note: Note, pendingSync?: boolean) => Promise<void>;
  resolveNoteId: (id: string) => string;
  waitForInFlightCreate: (id: string) => Promise<void>;
  dropGoneNote: (noteId: string) => void;
};

/**
 * Cache and gone-note helpers for a tag rename.
 * Create-in-flight id remap stays inside `useNotesMutations` (baselined; must not grow),
 * so `resolveNoteId` here is identity and `waitForInFlightCreate` is a no-op.
 */
export function useNotesTagRenameCollaborators(shell: NotesShellState, list: NotesListState) {
  const { setNotes, setArchived } = shell;
  const { setSelectedIds, setActiveId } = list;

  const persistOptimisticNote = useCallback((note: Note, pendingSync = true): Promise<void> => {
    const username = readOfflineNotesUsername();
    if (!username) return Promise.resolve();
    const write = upsertNoteInCache(username, note, pendingSync);
    persistBestEffort(write);
    return write;
  }, []);

  const resolveNoteId = useCallback((id: string) => id, []);
  const waitForInFlightCreate = useCallback(async () => undefined, []);

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

  return { persistOptimisticNote, resolveNoteId, waitForInFlightCreate, dropGoneNote };
}

export function useNotesTagRename({
  shell,
  queueMutation,
  persistOptimisticNote,
  resolveNoteId,
  waitForInFlightCreate,
  dropGoneNote,
}: UseNotesTagRenameArgs) {
  const renameTag = useCallback(
    (rawFrom: string, rawTo: string) => {
      const { notes, setNotes, view, selectView, operations, showMutationError, L } = shell;
      const plan = planNoteTagRename(notes, rawFrom, rawTo);
      if (typeof plan === "string") {
        if (plan === "invalid-name") showMutationError(L.tagRenameInvalidMessage);
        return;
      }

      const editedAt = new Date().toISOString();
      const rewritten = (row: Note) => ({
        ...row,
        tags: noteTagsAfterRename(row.tags, plan.from, plan.to),
        date: editedAt,
      });
      setNotes((prev) =>
        prev.map((note) => (plan.notes.some((row) => row.id === note.id) ? rewritten(note) : note)),
      );
      plan.notes.forEach((row) => {
        persistOptimisticNote(rewritten(row), true);
      });
      if (view === `tag:${plan.from}`) selectView(`tag:${plan.to}`);
      if (!operations) return;

      const restoreSnapshots = () => {
        setNotes((prev) =>
          prev.map((note) => plan.notes.find((row) => row.id === note.id) ?? note),
        );
      };
      const requeueInverse = () => {
        const reversible = plan.notes.filter((row) => !plan.mergedIds.includes(row.id));
        if (reversible.length === 0) return;
        queueMutation({
          key: `notes:tag-rename-undo:${plan.from}:${plan.to}`,
          toastMessage: L.tagRenameUndone,
          icon: <Tag className="size-4" />,
          execute: () =>
            Promise.all(
              reversible.map(async (row) => {
                await waitForInFlightCreate(row.id);
                const persistId = resolveNoteId(row.id);
                return persistNoteKeepingSyncRace(
                  operations.upsertNote(
                    { ...row, id: persistId },
                    { tagsAdd: [plan.from], tagsRemove: [plan.to] },
                  ),
                  () => dropGoneNote(row.id),
                  persistId,
                );
              }),
            ).then(() => {}),
          undo: restoreSnapshots,
          onError: restoreSnapshots,
          undoToastMessage: L.tagRenameUndone,
        });
      };
      const rollback = () => {
        restoreSnapshots();
        requeueInverse();
      };

      queueMutation({
        key: `notes:tag-rename:${plan.from}:${plan.to}`,
        toastMessage:
          plan.skippedCount > 0
            ? L.tagRenamedSomeSkipped(plan.to, plan.notes.length, plan.skippedCount)
            : L.tagRenamed(plan.to, plan.notes.length),
        icon: <Tag className="size-4" />,
        execute: () =>
          Promise.all(
            plan.notes.map(async (row) => {
              await waitForInFlightCreate(row.id);
              const persistId = resolveNoteId(row.id);
              const next = {
                ...row,
                id: persistId,
                tags: noteTagsAfterRename(row.tags, plan.from, plan.to),
              };
              return persistNoteKeepingSyncRace(
                operations.upsertNote(next, { tagsAdd: [plan.to], tagsRemove: [plan.from] }),
                () => dropGoneNote(row.id),
                persistId,
              );
            }),
          ).then(() => {}),
        undo: rollback,
        onError: rollback,
        undoToastMessage: L.tagRenameUndone,
      });
    },
    [
      dropGoneNote,
      persistOptimisticNote,
      queueMutation,
      resolveNoteId,
      shell,
      waitForInFlightCreate,
    ],
  );

  return { renameTag };
}
