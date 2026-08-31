import { useCallback, useState } from "react";
import type { CollectionShareWith } from "@/share-ui/collection-share";
import type {
  TaskProjectDialogConfirmInput,
  TaskProjectDialogState,
} from "@/tasks-core/src/task-project-dialog";
import { taskListDotColor } from "@/tasks-core/src/tasks-task-utils";
import { notebookViewKey } from "@/notes-core/src/use-notes-sidebar-model";
import { notesWithRenamedNotebook } from "@/notes-core/src/notes-note-utils";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";

function findNotebookCollection(
  collections: NotesNotebookCollection[],
  notebookId: string,
): NotesNotebookCollection | undefined {
  return (
    collections.find((item) => item.id === notebookId) ??
    collections.find((item) => item.name === notebookId)
  );
}

function notebookPatchFromDialog(
  current: NotesNotebookCollection,
  { name, color, groupSlug }: TaskProjectDialogConfirmInput,
): {
  name?: string;
  color?: string | null;
  groupSlug?: string | null;
} {
  const patch: {
    name?: string;
    color?: string | null;
    groupSlug?: string | null;
  } = {};
  const trimmed = name.trim();
  if (trimmed !== current.name) patch.name = trimmed;
  const displayColor = taskListDotColor({ id: current.id, color: current.color }).toLowerCase();
  const selectedColor = (color?.trim() || displayColor).toLowerCase();
  if (selectedColor !== displayColor) {
    patch.color = color?.trim() || null;
  }
  const nextGroupSlug = groupSlug !== undefined ? groupSlug?.trim() || null : undefined;
  const currentGroupSlug = current.groupSlug?.trim() || null;
  const canChangeOwner = current.isSharee !== true && current.isDefault !== true;
  if (canChangeOwner && nextGroupSlug !== undefined && nextGroupSlug !== currentGroupSlug) {
    patch.groupSlug = nextGroupSlug;
  }
  return patch;
}

type UseNotesNotebookMutationsArgs = {
  shell: NotesShellState;
};

export function useNotesNotebookMutations({ shell }: UseNotesNotebookMutationsArgs) {
  const {
    L,
    operations,
    notebooks,
    setNotebooks,
    notebookCollections,
    setNotebookCollections,
    setNotes,
    selectView,
    view,
    show,
    showMutationError,
  } = shell;
  const [notebookDialog, setNotebookDialog] = useState<TaskProjectDialogState>(null);

  const canManageNotebooks = Boolean(operations?.createNotebook && operations?.patchNotebook);

  const createNotebook = useCallback(
    async ({
      name,
      color,
      groupSlug,
    }: TaskProjectDialogConfirmInput): Promise<NotesNotebookCollection | undefined> => {
      if (!operations?.createNotebook) return undefined;
      const trimmed = name.trim();
      if (!trimmed) return undefined;
      try {
        const created = await operations.createNotebook(trimmed, {
          ...(color?.trim() ? { color: color.trim() } : {}),
          ...(groupSlug?.trim() ? { groupSlug: groupSlug.trim() } : {}),
        });
        const collection: NotesNotebookCollection = created ?? {
          id: trimmed,
          name: trimmed,
          color: color?.trim() || null,
          isSharee: false,
          scope: groupSlug?.trim() ? "group" : "personal",
          groupSlug: groupSlug?.trim() || null,
        };
        setNotebookCollections((prev) =>
          prev.some((item) => item.id === collection.id || item.name === collection.name)
            ? prev
            : [...prev, collection],
        );
        if (!collection.groupSlug) {
          setNotebooks((prev) =>
            prev.includes(collection.name) ? prev : [...prev, collection.name],
          );
        }
        selectView(notebookViewKey(collection.id));
        show(L.toastSaved);
        setNotebookDialog(null);
        return collection;
      } catch {
        showMutationError();
        return undefined;
      }
    },
    [
      L.toastSaved,
      operations,
      selectView,
      setNotebookCollections,
      setNotebooks,
      show,
      showMutationError,
    ],
  );

  const updateNotebook = useCallback(
    async (notebookId: string, input: TaskProjectDialogConfirmInput) => {
      if (!operations?.patchNotebook) return;
      const trimmed = input.name.trim();
      if (!trimmed) return;
      const current = findNotebookCollection(notebookCollections, notebookId);
      const patch = current
        ? notebookPatchFromDialog(current, input)
        : {
            name: trimmed,
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.groupSlug !== undefined
              ? { groupSlug: input.groupSlug?.trim() || null }
              : {}),
          };
      if (Object.keys(patch).length === 0) {
        setNotebookDialog(null);
        return;
      }
      try {
        const targetId = current?.id ?? notebookId;
        const updated = await operations.patchNotebook(targetId, patch);
        const nextName = updated.name.trim() || trimmed;
        const previousName = current?.name;
        setNotebookCollections((prev) => {
          if (prev.some((item) => item.id === targetId)) {
            return prev.map((item) => (item.id === targetId ? { ...item, ...updated } : item));
          }
          return [...prev, updated];
        });
        if (previousName !== nextName) {
          setNotes((prev) =>
            notesWithRenamedNotebook(prev, {
              notebookId: targetId,
              fromName: previousName ?? nextName,
              toName: nextName,
            }),
          );
        }
        if (current && nextName !== current.name && current.scope !== "group") {
          setNotebooks((prev) => prev.map((item) => (item === current.name ? nextName : item)));
        }
        show(L.toastSaved);
        setNotebookDialog(null);
      } catch {
        showMutationError();
      }
    },
    [
      L.toastSaved,
      notebookCollections,
      operations,
      setNotebookCollections,
      setNotebooks,
      setNotes,
      show,
      showMutationError,
    ],
  );

  const patchShareWith = useCallback(
    async (notebookId: string, shareWith: CollectionShareWith) => {
      if (!operations?.patchNotebook) {
        throw new Error(L.shareNotebookOffline);
      }
      try {
        const updated = await operations.patchNotebook(notebookId, { shareWith });
        setNotebookCollections((prev) =>
          prev.map((item) => (item.id === notebookId ? { ...item, ...updated } : item)),
        );
        setNotebookDialog((current) =>
          current?.mode === "edit" && current.listId === notebookId
            ? { ...current, shareWith: updated.shareWith ?? null }
            : current,
        );
      } catch (error) {
        showMutationError();
        throw error;
      }
    },
    [L.shareNotebookOffline, operations, setNotebookCollections, showMutationError],
  );

  const removeSharedNotebook = useCallback(
    async (notebookId: string) => {
      if (!operations?.deleteNotebook) return;
      const current = notebookCollections.find((item) => item.id === notebookId);
      if (!current || !current.isSharee) return;
      try {
        await operations.deleteNotebook(current.name, { kind: "purge" });
        setNotebookCollections((prev) => prev.filter((item) => item.id !== notebookId));
        if (view === notebookViewKey(notebookId) || view === `nb:${current.name}`) {
          selectView("all");
        }
        show(L.toastSaved);
        setNotebookDialog(null);
      } catch {
        showMutationError();
      }
    },
    [
      L.toastSaved,
      notebookCollections,
      operations,
      selectView,
      setNotebookCollections,
      show,
      showMutationError,
      view,
    ],
  );

  const deleteNotebookCollection = useCallback(
    async (notebookId: string) => {
      if (!operations?.deleteNotebook) return;
      const current = findNotebookCollection(notebookCollections, notebookId);
      if (!current || current.isSharee === true || current.isDefault === true) return;
      try {
        await operations.deleteNotebook(current.name, { kind: "purge" });
        const targetId = current.id;
        setNotebookCollections((prev) =>
          prev.filter((item) => item.id !== targetId && item.name !== current.name),
        );
        setNotebooks((prev) => prev.filter((name) => name !== current.name));
        setNotes((prev) =>
          prev.filter((note) => {
            if (note.notebookId) return note.notebookId !== targetId;
            return note.notebook !== current.name;
          }),
        );
        if (view === notebookViewKey(notebookId) || view === `nb:${current.name}`) {
          selectView("all");
        }
        show(L.toastSaved);
        setNotebookDialog(null);
      } catch {
        showMutationError();
      }
    },
    [
      L.toastSaved,
      notebookCollections,
      operations,
      selectView,
      setNotebookCollections,
      setNotebooks,
      setNotes,
      show,
      showMutationError,
      view,
    ],
  );

  const openCreateNotebookDialog = useCallback(() => {
    setNotebookDialog({ mode: "create" });
  }, []);

  const openEditNotebookDialog = useCallback(
    (notebook: NotesNotebookCollection) => {
      setNotebookDialog({
        mode: "edit",
        listId: notebook.id,
        name: notebook.name,
        color: notebook.color ?? null,
        scope: notebook.scope === "group" ? "group" : "personal",
        groupSlug: notebook.groupSlug ?? null,
        mayShare: notebook.myRights?.mayShare === true || notebook.isSharee !== true,
        isSharee: notebook.isSharee === true,
        shareWith: notebook.shareWith ?? null,
        canChangeOwner: notebook.isSharee !== true && notebook.isDefault !== true,
        mayDelete:
          notebook.isSharee !== true &&
          notebook.isDefault !== true &&
          Boolean(operations?.deleteNotebook),
      });
    },
    [operations?.deleteNotebook],
  );

  return {
    canManageNotebooks,
    notebookDialog,
    setNotebookDialog,
    openCreateNotebookDialog,
    openEditNotebookDialog,
    createNotebook,
    updateNotebook,
    deleteNotebookCollection,
    patchShareWith,
    removeSharedNotebook,
    notebooks,
  };
}
