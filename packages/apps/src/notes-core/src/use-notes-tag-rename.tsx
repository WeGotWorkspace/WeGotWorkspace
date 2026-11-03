import { useCallback, useRef } from "react";
import { Tag } from "lucide-react";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import type { Note } from "@/lib/models/note";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { normalizeTag } from "@/notes-core/src/note-tag";
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
  dropGoneNote: (noteId: string) => void;
};

/** Cache and gone-note helpers for a tag rename. A note keeps its id from creation. */
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

  return { persistOptimisticNote, dropGoneNote };
}

function tagViewMatches(view: string, tag: string): boolean {
  return view.startsWith("tag:") && normalizeTag(view.slice(4)) === tag;
}

export function useNotesTagRename({
  shell,
  queueMutation,
  persistOptimisticNote,
  dropGoneNote,
}: UseNotesTagRenameArgs) {
  const shellRef = useRef(shell);
  shellRef.current = shell;

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
      if (tagViewMatches(view, plan.from)) selectView(`tag:${plan.to}`);
      if (!operations) return;

      const retargetIf = (tag: string, next: string) => {
        const live = shellRef.current;
        if (tagViewMatches(live.view, tag)) live.selectView(next);
      };
      const restoreSnapshots = () => {
        setNotes((prev) =>
          prev.map((note) => plan.notes.find((row) => row.id === note.id) ?? note),
        );
        plan.notes.forEach((row) => {
          persistOptimisticNote(row, true);
        });
        retargetIf(plan.to, `tag:${plan.from}`);
      };
      const reapplyRename = () => {
        setNotes((prev) =>
          prev.map((note) =>
            plan.notes.some((row) => row.id === note.id) ? rewritten(note) : note,
          ),
        );
        plan.notes.forEach((row) => {
          persistOptimisticNote(rewritten(row), true);
        });
        retargetIf(plan.from, `tag:${plan.to}`);
      };
      const sendDelta = (
        rows: Note[],
        delta: { tagsAdd: string[]; tagsRemove?: string[] },
      ): Promise<void> =>
        Promise.all(
          rows.map((row) =>
            persistNoteKeepingSyncRace(
              operations.upsertNote(row, delta),
              () => dropGoneNote(row.id),
              row.id,
            ),
          ),
        ).then(() => {});
      const requeueInverse = () => {
        const plain = plan.notes.filter((row) => !plan.mergedIds.includes(row.id));
        const merged = plan.notes.filter((row) => plan.mergedIds.includes(row.id));
        if (plain.length === 0 && merged.length === 0) return;
        queueMutation({
          key: `notes:tag-rename-undo:${plan.from}:${plan.to}`,
          toastMessage: L.tagRenameRestored(plan.from, plan.notes.length),
          icon: <Tag className="size-4" />,
          execute: () => {
            const writes: Promise<void>[] = [];
            if (plain.length > 0) {
              writes.push(sendDelta(plain, { tagsAdd: [plan.from], tagsRemove: [plan.to] }));
            }
            if (merged.length > 0) writes.push(sendDelta(merged, { tagsAdd: [plan.from] }));
            return Promise.all(writes).then(() => {});
          },
          undo: reapplyRename,
          onError: reapplyRename,
          undoToastMessage: L.tagRenamed(plan.to, plan.notes.length),
        });
      };
      let started = false;
      const rollback = () => {
        restoreSnapshots();
        if (started) requeueInverse();
      };

      queueMutation({
        key: `notes:tag-rename:${plan.from}:${plan.to}`,
        toastMessage:
          plan.skippedCount > 0
            ? L.tagRenamedSomeSkipped(plan.to, plan.notes.length, plan.skippedCount)
            : L.tagRenamed(plan.to, plan.notes.length),
        icon: <Tag className="size-4" />,
        execute: () => {
          started = true;
          return sendDelta(
            plan.notes.map((row) => rewritten(row)),
            { tagsAdd: [plan.to], tagsRemove: [plan.from] },
          );
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: L.tagRenameUndone,
      });
    },
    [dropGoneNote, persistOptimisticNote, queueMutation, shell],
  );

  return { renameTag };
}
