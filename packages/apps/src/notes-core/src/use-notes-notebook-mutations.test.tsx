import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNotesNotebookMutations } from "@/notes-core/src/use-notes-notebook-mutations";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";
import { defaultNotesLabels, notesNotebookDialogLabelsFrom } from "@/notes-core/src/notes-labels";
import { TaskProjectDialog } from "@/tasks-core/src/task-project-dialog";

function shellStub(overrides: Partial<NotesShellState> = {}): NotesShellState {
  return {
    L: defaultNotesLabels,
    operations: {
      upsertNote: vi.fn(),
      deleteNote: vi.fn(),
      archiveNote: vi.fn(),
      restoreNote: vi.fn(),
      createNotebook: vi.fn().mockResolvedValue({
        id: "notes-ideas",
        name: "Ideas",
        color: "#ec4899",
      }),
      patchNotebook: vi.fn().mockResolvedValue({
        id: "notes-general",
        name: "Journal",
        color: "#ec4899",
      }),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
    },
    notebooks: ["General"],
    setNotebooks: vi.fn(),
    notebookCollections: [
      {
        id: "notes-general",
        name: "General",
        color: "#14b8a6",
        isSharee: false,
        isDefault: false,
        scope: "personal",
        groupSlug: null,
      },
    ],
    setNotebookCollections: vi.fn(),
    setNotes: vi.fn(),
    selectView: vi.fn(),
    view: "all",
    show: vi.fn(),
    showMutationError: vi.fn(),
    ...overrides,
  } as NotesShellState;
}

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("useNotesNotebookMutations", () => {
  beforeEach(() => {
    cleanup();
    stubMatchMedia();
  });

  it("opens create and edit dialogs for collection chrome", () => {
    const { result } = renderHook(() => useNotesNotebookMutations({ shell: shellStub() }));
    expect(result.current.canManageNotebooks).toBe(true);
    act(() => {
      result.current.openCreateNotebookDialog();
    });
    expect(result.current.notebookDialog).toEqual({ mode: "create" });
    act(() => {
      result.current.openEditNotebookDialog({
        id: "notes-general",
        name: "General",
        color: "#14b8a6",
        isSharee: false,
      });
    });
    expect(result.current.notebookDialog).toMatchObject({
      mode: "edit",
      listId: "notes-general",
      name: "General",
      canChangeOwner: true,
    });
  });

  it("createNotebook forwards name, color, and owner", async () => {
    const createNotebook = vi.fn().mockResolvedValue({
      id: "notes-ideas",
      name: "Ideas",
      color: "#ec4899",
      scope: "group",
      groupSlug: "team",
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          operations: {
            ...shellStub().operations!,
            createNotebook,
          },
        }),
      }),
    );

    let created: Awaited<ReturnType<typeof result.current.createNotebook>>;
    await act(async () => {
      created = await result.current.createNotebook({
        name: "Ideas",
        color: "#ec4899",
        groupSlug: "team",
      });
    });

    expect(createNotebook).toHaveBeenCalledWith("Ideas", {
      color: "#ec4899",
      groupSlug: "team",
    });
    expect(created!).toMatchObject({ id: "notes-ideas", name: "Ideas" });
  });

  it("createNotebook keeps sibling notebooks and persists color in the list row", async () => {
    let collections = [
      {
        id: "notes-general",
        name: "General",
        color: "#14b8a6",
        isSharee: false,
        isDefault: true,
        scope: "personal" as const,
        groupSlug: null,
      },
      {
        id: "notes-drafts",
        name: "Drafts",
        color: "#0ea5e9",
        isSharee: false,
        isDefault: false,
        scope: "personal" as const,
        groupSlug: null,
      },
    ];
    const setNotebookCollections = vi.fn((updater) => {
      collections = typeof updater === "function" ? updater(collections) : updater;
    });
    const createNotebook = vi.fn().mockResolvedValue({
      id: "notes-ideas",
      name: "Ideas",
      color: "#ec4899",
      isSharee: false,
      scope: "personal",
      groupSlug: null,
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          notebookCollections: collections,
          setNotebookCollections,
          operations: {
            ...shellStub().operations!,
            createNotebook,
          },
        }),
      }),
    );

    await act(async () => {
      await result.current.createNotebook({
        name: "Ideas",
        color: "#ec4899",
        groupSlug: null,
      });
    });

    expect(createNotebook).toHaveBeenCalledWith("Ideas", { color: "#ec4899" });
    expect(collections.map((item) => item.name)).toEqual(["General", "Drafts", "Ideas"]);
    expect(collections.find((item) => item.name === "Ideas")?.color).toBe("#ec4899");
  });

  it("createNotebook named Starred selects the REST id, not the starred view", async () => {
    const selectView = vi.fn();
    const createNotebook = vi.fn().mockResolvedValue({
      id: "notebook",
      name: "Starred",
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          selectView,
          operations: {
            ...shellStub().operations!,
            createNotebook,
          },
        }),
      }),
    );

    await act(async () => {
      await result.current.createNotebook({ name: "Starred" });
    });

    expect(createNotebook).toHaveBeenCalledWith("Starred", {});
    expect(selectView).toHaveBeenCalledWith("nb:notebook");
    expect(selectView).not.toHaveBeenCalledWith("starred");
    expect(selectView).not.toHaveBeenCalledWith("nb:Starred");
  });

  it("updateNotebook patches name, color, and owner", async () => {
    const patchNotebook = vi.fn().mockResolvedValue({
      id: "notes-general",
      name: "Journal",
      color: "#ec4899",
      scope: "group",
      groupSlug: "team",
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          operations: {
            ...shellStub().operations!,
            patchNotebook,
          },
        }),
      }),
    );

    await act(async () => {
      await result.current.updateNotebook("notes-general", {
        name: "Journal",
        color: "#ec4899",
        groupSlug: "team",
      });
    });

    expect(patchNotebook).toHaveBeenCalledWith("notes-general", {
      name: "Journal",
      color: "#ec4899",
      groupSlug: "team",
    });
    expect(result.current.notebookDialog).toBe(null);
  });

  it("updateNotebook rewrites denormalized note.notebook for the renamed collection only", async () => {
    let notes = [
      {
        id: "n-1",
        notebook: "General",
        notebookId: "notes-general",
        category: "Note",
        date: "—",
        excerpt: "",
        body: [""],
        tags: [] as string[],
        wordCount: 0,
      },
      {
        id: "n-2",
        notebook: "Work",
        notebookId: "notes-work",
        category: "Note",
        date: "—",
        excerpt: "",
        body: [""],
        tags: [] as string[],
        wordCount: 0,
      },
    ];
    const setNotes = vi.fn((updater) => {
      notes = typeof updater === "function" ? updater(notes) : updater;
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          setNotes,
        }),
      }),
    );

    await act(async () => {
      await result.current.updateNotebook("notes-general", {
        name: "Journal",
        color: null,
      });
    });

    expect(notes.map((note) => ({ id: note.id, notebook: note.notebook }))).toEqual([
      { id: "n-1", notebook: "Journal" },
      { id: "n-2", notebook: "Work" },
    ]);
  });

  it("updateNotebook still patches when collections were dropped from cache", async () => {
    const patchNotebook = vi.fn().mockResolvedValue({
      id: "notes-general",
      name: "Journal",
      color: "#22c55e",
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          notebookCollections: [],
          operations: {
            ...shellStub().operations!,
            patchNotebook,
          },
        }),
      }),
    );

    await act(async () => {
      await result.current.updateNotebook("notes-general", {
        name: "Journal",
        color: "#22c55e",
      });
    });

    expect(patchNotebook).toHaveBeenCalledWith("notes-general", {
      name: "Journal",
      color: "#22c55e",
    });
  });

  it("Save on edit calls patchNotebook with name, color, and owner", async () => {
    const patchNotebook = vi.fn().mockResolvedValue({
      id: "notes-general",
      name: "Journal",
      color: "#ec4899",
      scope: "group",
      groupSlug: "team",
    });
    const { result } = renderHook(() =>
      useNotesNotebookMutations({
        shell: shellStub({
          operations: {
            ...shellStub().operations!,
            patchNotebook,
          },
        }),
      }),
    );

    act(() => {
      result.current.openEditNotebookDialog({
        id: "notes-general",
        name: "General",
        color: "#14b8a6",
        isSharee: false,
        isDefault: false,
        scope: "personal",
        groupSlug: null,
      });
    });

    render(
      <TaskProjectDialog
        dialog={result.current.notebookDialog}
        groups={[{ slug: "team", displayName: "Team" }]}
        personalOwnerLabel="Ada"
        onClose={vi.fn()}
        onConfirm={(input) => {
          const dialog = result.current.notebookDialog;
          if (dialog?.mode !== "edit") return;
          void result.current.updateNotebook(dialog.listId, input);
        }}
        labels={notesNotebookDialogLabelsFrom(defaultNotesLabels)}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultNotesLabels.notebookNameLabel), {
      target: { value: "Journal" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.notebookColorLabel }));
    fireEvent.click(screen.getByRole("radio", { name: "#ec4899" }));
    fireEvent.click(screen.getByRole("combobox", { name: defaultNotesLabels.notebookOwnerLabel }));
    fireEvent.click(
      screen.getByRole("option", { name: defaultNotesLabels.notebookOwnerGroup("Team") }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.saveNotebookButton }));
    fireEvent.click(
      screen.getByRole("button", { name: defaultNotesLabels.changeNotebookOwnerConfirm }),
    );

    await waitFor(() => {
      expect(patchNotebook).toHaveBeenCalledWith("notes-general", {
        name: "Journal",
        color: "#ec4899",
        groupSlug: "team",
      });
    });
  });
});
