import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { buildPermanentDeleteDescription } from "@/lib/workspace/destructive-dialog";
import type { Note } from "@/lib/models/note";
import {
  isNotesAlreadyExists,
  isNotesForbidden,
  isNotesNotebookHasContents,
} from "@/lib/api/wgw/notes-vjournal";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";
import { NotesChangeNotebookDialog } from "@/notes-core/src/notes-change-notebook-dialog";
import { noteAfterNotebookMove } from "@/notes-core/src/notes-note-utils";
import { canDeleteNotebook } from "@/notes-core/src/notes-notebook-write";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";
import { isViewOnlyNotebook, notebookViewKey } from "@/notes-core/src/use-notes-sidebar-model";

async function notesStoredInNotebook(
  notebook: { id: string; name: string },
  visibleNotes: readonly Note[],
): Promise<number> {
  const username = readOfflineNotesUsername();
  const cached = username ? await readNotesBootstrapFromCache(username) : null;
  const ids = new Set<string>();
  for (const note of [...(cached?.data.notes ?? []), ...visibleNotes]) {
    if (noteInNotebook(note, notebook)) ids.add(note.id);
  }
  return ids.size;
}

function noteInNotebook(note: Note, notebook: { id: string; name: string }): boolean {
  if (note.notebookId) return note.notebookId === notebook.id;
  return note.notebook === notebook.name;
}

function findNotebook(
  collections: readonly NotesNotebookCollection[],
  notebookId: string,
): NotesNotebookCollection | undefined {
  return (
    collections.find((item) => item.id === notebookId) ??
    collections.find((item) => item.name === notebookId)
  );
}

type UseNotesNotebookDeleteArgs = {
  shell: NotesShellState;
  onCreateNotebook?: () => void;
  onFinished?: () => void;
};

export function useNotesNotebookDelete({
  shell,
  onCreateNotebook,
  onFinished,
}: UseNotesNotebookDeleteArgs): {
  requestDeleteNotebook: (notebookId: string) => Promise<void>;
  acceptCreatedNotebook: (notebook: NotesNotebookCollection) => void;
  notebookDeleteDialog: ReactElement;
} {
  const {
    L,
    operations,
    notes,
    setNotebooks,
    notebookCollections,
    setNotebookCollections,
    setNotes,
    selectView,
    view,
    show,
    showMutationError,
  } = shell;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createdNotebook, setCreatedNotebook] = useState<NotesNotebookCollection | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const moveInFlight = useRef(false);
  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "notes-dialog-surface",
  });

  const pending = pendingId ? findNotebook(notebookCollections, pendingId) : undefined;

  const finishRemoved = useCallback(
    (current: NotesNotebookCollection, nextNotes: (prev: Note[]) => Note[], toast: string) => {
      setNotebookCollections((prev) =>
        prev.filter((item) => item.id !== current.id && item.name !== current.name),
      );
      setNotebooks((prev) => prev.filter((name) => name !== current.name));
      setNotes(nextNotes);
      if (view === notebookViewKey(current.id) || view === `nb:${current.name}`) {
        selectView("all");
      }
      show(toast);
      setPendingId(null);
      setCreatedNotebook(null);
      onFinished?.();
    },
    [onFinished, selectView, setNotebookCollections, setNotebooks, setNotes, show, view],
  );

  const requestDeleteNotebook = useCallback(
    async (notebookId: string) => {
      if (!operations?.deleteNotebook) return;
      const current = findNotebook(notebookCollections, notebookId);
      if (!current || !canDeleteNotebook(current)) return;
      try {
        if (!readBrowserOnline() && (await notesStoredInNotebook(current, notes)) > 0) {
          setPendingId(current.id);
          return;
        }
        await operations.deleteNotebook(current.id, { kind: "purge-if-empty" });
        finishRemoved(
          current,
          (prev) => prev.filter((note) => !noteInNotebook(note, current)),
          L.toastNotebookDeleted(current.name),
        );
      } catch (error) {
        if (isNotesNotebookHasContents(error)) {
          setPendingId(current.id);
          return;
        }
        showMutationError();
      }
    },
    [L, finishRemoved, notebookCollections, notes, operations, showMutationError],
  );

  const moveNotesAndDelete = useCallback(
    async (destinationId: string) => {
      if (moveInFlight.current || !pending || !operations?.deleteNotebook) return;
      const dest = findNotebook(notebookCollections, destinationId);
      if (!dest) return;
      moveInFlight.current = true;
      setMoveBusy(true);
      try {
        await operations.deleteNotebook(pending.id, { kind: "move", target: dest.id });
        finishRemoved(
          pending,
          (prev) =>
            prev.map((note) =>
              noteInNotebook(note, pending) ? noteAfterNotebookMove(note, dest) : note,
            ),
          L.toastNotebookDeletedNotesMoved(pending.name, dest.name),
        );
      } catch (error) {
        if (isNotesAlreadyExists(error)) showMutationError(L.deleteNotebookUidCollision);
        else if (isNotesForbidden(error)) showMutationError(L.deleteNotebookDestinationReadOnly);
        else showMutationError();
      } finally {
        moveInFlight.current = false;
        setMoveBusy(false);
      }
    },
    [L, finishRemoved, notebookCollections, operations, pending, showMutationError],
  );

  const deleteNotebookWithNotes = useCallback(async () => {
    if (!pending || !operations?.deleteNotebook) return;
    try {
      await operations.deleteNotebook(pending.id, { kind: "purge" });
      finishRemoved(
        pending,
        (prev) => prev.filter((note) => !noteInNotebook(note, pending)),
        L.toastNotebookDeleted(pending.name),
      );
    } catch {
      showMutationError();
    }
  }, [L, finishRemoved, operations, pending, showMutationError]);

  const requestDeleteNotesToo = useCallback(() => {
    if (!pending) return;
    requestConfirm({
      title: L.deleteNotebookConfirmTitle,
      description: buildPermanentDeleteDescription({
        leadIn: L.dialogPermanentDeleteLeadIn,
        target: pending.name,
        suffix: L.dialogDeleteConfirmSuffix,
      }),
      confirmLabel: L.dialogDelete,
      cancelLabel: L.dialogCancel,
      variant: "destructive",
      onConfirm: () => {
        void deleteNotebookWithNotes();
      },
    });
  }, [L, deleteNotebookWithNotes, pending, requestConfirm]);

  const destinations = useMemo(
    () =>
      notebookCollections.filter(
        (item) =>
          item.id !== pending?.id && item.name !== pending?.name && !isViewOnlyNotebook(item),
      ),
    [notebookCollections, pending?.id, pending?.name],
  );

  const acceptCreatedNotebook = useCallback(
    (notebook: NotesNotebookCollection) => {
      if (!pendingId) return;
      setCreatedNotebook(notebook);
    },
    [pendingId],
  );

  const draft = createdNotebook ?? destinations[0];
  const notebookDeleteDialog = (
    <>
      <NotesChangeNotebookDialog
        open={pending !== undefined}
        notebooks={destinations.map((item) => ({
          id: item.id,
          name: item.name,
          color: item.color,
        }))}
        value={draft ? { id: draft.id, name: draft.name, color: draft.color } : { name: "" }}
        createdNotebook={
          createdNotebook
            ? { id: createdNotebook.id, name: createdNotebook.name, color: createdNotebook.color }
            : null
        }
        labels={L}
        title={L.deleteNotebookHasNotesTitle}
        description={L.deleteNotebookHasNotesDescription}
        confirmLabel={(destination) => L.deleteNotebookMoveToConfirm(destination)}
        confirmDisabled={moveBusy}
        requireChange={false}
        destructiveAction={{
          label: L.deleteNotebookDeleteNotesToo,
          onAction: requestDeleteNotesToo,
        }}
        onClose={() => {
          if (moveInFlight.current) return;
          setPendingId(null);
          setCreatedNotebook(null);
        }}
        onNotebookChange={(notebook) => {
          void moveNotesAndDelete(notebook.id);
        }}
        onCreateNotebook={onCreateNotebook}
      />
      {confirmDialog}
    </>
  );

  return { requestDeleteNotebook, acceptCreatedNotebook, notebookDeleteDialog };
}
