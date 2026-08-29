import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { NOTES_VIEW_PREFS_STORAGE_KEY } from "./notes-view-prefs";
import type { NotesUIData } from "./notes-types";
import { useNotesController } from "./use-notes-controller";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

const localNote: Note = {
  id: "local-offline-create",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "Draft excerpt",
  body: ["Draft body"],
  notebook: "Drafts",
  tags: [],
  wordCount: 2,
};

const syncedNote: Note = {
  ...localNote,
  id: "server-note-99",
  excerpt: "Synced excerpt",
  body: ["Synced body"],
};

function clickSelect(result: { current: ReturnType<typeof useNotesController> }, id: string) {
  act(() => {
    result.current.handleSelect(id, {
      detail: 1,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as ReactMouseEvent);
  });
}

describe("useNotesController bootstrap sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(NOTES_VIEW_PREFS_STORAGE_KEY);
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
  });

  it("follows activeId when a local temp note is remapped during sync", () => {
    const initialData: NotesUIData = {
      notes: [localNote],
      notebooks: ["Drafts"],
      tags: [],
    };
    const syncedData: NotesUIData = {
      notes: [syncedNote],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result, rerender } = renderHook(
      ({ data }: { data: NotesUIData }) => useNotesController({ data, listLoading: false }),
      { initialProps: { data: initialData } },
    );

    clickSelect(result, localNote.id);
    expect(result.current.activeId).toBe(localNote.id);

    rerender({ data: syncedData });

    expect(result.current.activeId).toBe(syncedNote.id);
    expect(result.current.active?.id).toBe(syncedNote.id);
    expect(result.current.active?.body).toEqual(["Synced body"]);
  });

  it("updates active.tags when toggleNoteTag assigns a tag", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", tags: [] }],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    clickSelect(result, "note-1");
    expect(result.current.active?.tags).toEqual([]);

    act(() => {
      result.current.toggleNoteTag("note-1", "focus");
    });

    expect(result.current.active?.tags).toEqual(["focus"]);
    expect(result.current.notes.find((note) => note.id === "note-1")?.tags).toEqual(["focus"]);
  });

  it("keeps assigned tag on active note until bootstrap carries it", () => {
    const initialData: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", tags: [] }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const staleBootstrap: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", tags: [] }],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result, rerender } = renderHook(
      ({ data, bootstrapRevision }: { data: NotesUIData; bootstrapRevision?: number }) =>
        useNotesController({ data, listLoading: false, bootstrapRevision }),
      { initialProps: { data: initialData, bootstrapRevision: 0 } },
    );

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleNoteTag("note-1", "focus");
    });
    expect(result.current.active?.tags).toEqual(["focus"]);

    // Same revision, new data object — must not wipe optimistic tags.
    rerender({ data: staleBootstrap, bootstrapRevision: 0 });
    expect(result.current.active?.tags).toEqual(["focus"]);

    // Bumped revision with still-stale server tags — still keep local chips.
    rerender({ data: staleBootstrap, bootstrapRevision: 1 });
    expect(result.current.active?.tags).toEqual(["focus"]);
  });

  it("preserves tags when create remaps local-* id to server id", async () => {
    let resolveCreate!: (note: Note) => void;
    const operations = {
      upsertNote: vi.fn(
        () =>
          new Promise<Note>((resolve) => {
            resolveCreate = resolve;
          }),
      ),
      deleteNote: vi.fn(),
      archiveNote: vi.fn(),
      restoreNote: vi.fn(),
      createNotebook: vi.fn(),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
    };

    const data: NotesUIData = {
      notes: [],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations }),
    );

    act(() => {
      result.current.createNote();
    });
    const tempId = result.current.activeId;
    expect(tempId).toMatch(/^local-/);

    act(() => {
      result.current.toggleNoteTag(tempId, "focus");
    });
    expect(result.current.active?.tags).toEqual(["focus"]);

    const serverDate = new Date().toISOString();
    await act(async () => {
      resolveCreate({
        id: "n-server-1",
        category: "Note",
        date: serverDate,
        updatedAt: serverDate,
        excerpt: "",
        body: [""],
        notebook: "Drafts",
        tags: [],
        wordCount: 0,
      });
      await Promise.resolve();
    });

    expect(result.current.activeId).toBe("n-server-1");
    expect(result.current.active?.tags).toEqual(["focus"]);
    expect(result.current.notes.find((note) => note.id === "n-server-1")?.tags).toEqual(["focus"]);
  });

  it("preserves tags when bootstrap remaps local-* to a server id", () => {
    const taggedLocal: Note = {
      ...localNote,
      tags: ["focus"],
      date: "2026-08-10T12:00:00.000Z",
    };
    const initialData: NotesUIData = {
      notes: [taggedLocal],
      notebooks: ["Drafts"],
      tags: ["focus"],
    };
    const syncedData: NotesUIData = {
      notes: [
        {
          ...syncedNote,
          tags: [],
          date: "2026-08-10T11:00:00.000Z",
          excerpt: taggedLocal.excerpt,
          body: taggedLocal.body,
        },
      ],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result, rerender } = renderHook(
      ({ data }: { data: NotesUIData }) => useNotesController({ data, listLoading: false }),
      { initialProps: { data: initialData } },
    );

    clickSelect(result, taggedLocal.id);
    expect(result.current.active?.tags).toEqual(["focus"]);

    rerender({ data: syncedData });

    expect(result.current.activeId).toBe(syncedNote.id);
    expect(result.current.active?.tags).toEqual(["focus"]);
  });

  it("renames the active notebook view when renameNotebook runs", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", notebook: "Drafts" }],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, initialView: "nb:Drafts" }),
    );

    expect(result.current.view).toBe("nb:Drafts");

    act(() => {
      result.current.renameNotebook("Drafts", "Journal");
    });

    expect(result.current.view).toBe("nb:Journal");
    expect(result.current.notes[0]?.notebook).toBe("Journal");
    expect(result.current.notebooks).toEqual(["Journal"]);
  });

  it("removes emptied personal notebooks from the sidebar on delete", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", notebook: "Drafts" }],
      // Stale leftover after notes were moved away — still listed from Dexie/bootstrap.
      notebooks: ["Drafts", "EmptyGhost"],
      tags: [],
    };

    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, initialView: "nb:EmptyGhost" }),
    );

    expect(result.current.notebooks).toEqual(expect.arrayContaining(["Drafts", "EmptyGhost"]));

    act(() => {
      result.current.deleteNotebook("EmptyGhost", {});
    });

    expect(result.current.notebooks).toEqual(["Drafts"]);
    expect(result.current.view).toBe("all");
  });

  it("refreshes the active note when bootstrap syncs updated server content", () => {
    const initialData: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", excerpt: "Before sync", body: ["Before body"] }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const syncedData: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", excerpt: "After sync", body: ["Server body"] }],
      notebooks: ["Drafts"],
      tags: [],
    };

    const { result, rerender } = renderHook(
      ({ data }: { data: NotesUIData }) => useNotesController({ data, listLoading: false }),
      { initialProps: { data: initialData } },
    );

    clickSelect(result, "note-1");
    expect(result.current.active?.body).toEqual(["Before body"]);

    rerender({ data: syncedData });

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.active?.body).toEqual(["Server body"]);
  });
});

describe("useNotesController URL routing", () => {
  const data: NotesUIData = {
    notes: [
      { ...localNote, id: "note-1" },
      { ...localNote, id: "note-2", notebook: "Ideas" },
    ],
    notebooks: ["Drafts", "Ideas"],
    tags: ["focus"],
  };

  it("initialView seeds the controller view on mount", () => {
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, initialView: "nb:Drafts" }),
    );

    expect(result.current.view).toBe("nb:Drafts");
  });

  it("initialNoteId selects the note on mount", () => {
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, initialNoteId: "note-1" }),
    );

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.active?.id).toBe("note-1");
  });

  it("syncs activeId when initialNoteId changes from the URL", () => {
    const { result, rerender } = renderHook(
      ({ initialNoteId }: { initialNoteId: string }) =>
        useNotesController({ data, listLoading: false, initialNoteId }),
      { initialProps: { initialNoteId: "" } },
    );

    expect(result.current.activeId).toBe("");

    rerender({ initialNoteId: "note-1" });

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
  });

  it("keeps selectedIds aligned with activeId after a primary click then URL note change", () => {
    const { result, rerender } = renderHook(
      ({ initialNoteId }: { initialNoteId: string }) =>
        useNotesController({ data, listLoading: false, initialNoteId }),
      { initialProps: { initialNoteId: "note-1" } },
    );

    clickSelect(result, "note-2");
    // Route sync catches up after onNoteChange (same as production).
    rerender({ initialNoteId: "note-2" });
    expect(result.current.activeId).toBe("note-2");
    expect(result.current.selectedIds).toEqual(["note-2"]);

    // Browser back / deep link to another note must not leave selectedIds on the old row.
    rerender({ initialNoteId: "note-1" });

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
  });

  it("onViewChange is called when selectView is invoked (not on mount)", () => {
    const onViewChange = vi.fn();
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, onViewChange }),
    );

    expect(onViewChange).not.toHaveBeenCalled();

    act(() => {
      result.current.selectView("archive");
    });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("archive");
  });

  it("onNoteChange is called when a note is selected (not on mount)", () => {
    const onNoteChange = vi.fn();
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, onNoteChange }),
    );

    expect(onNoteChange).not.toHaveBeenCalled();

    clickSelect(result, "note-1");

    expect(onNoteChange).toHaveBeenCalledTimes(1);
    expect(onNoteChange).toHaveBeenCalledWith("note-1");
  });

  it("onNoteChange is called for local-* temp ids so offline rows update the route", () => {
    const onNoteChange = vi.fn();
    const offlineData: NotesUIData = {
      notes: [localNote],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data: offlineData, listLoading: false, onNoteChange }),
    );

    clickSelect(result, localNote.id);

    expect(onNoteChange).toHaveBeenCalledWith("local-offline-create");
  });

  it("onNoteChange is called with empty string when view changes (note cleared)", () => {
    const onNoteChange = vi.fn();
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        initialNoteId: "note-1",
        onNoteChange,
      }),
    );

    act(() => {
      result.current.selectView("starred");
    });

    const calls = onNoteChange.mock.calls.map(([id]) => id);
    expect(calls).toContain("");
  });

  it("hides notes from unchecked notebooks on All, but not on that notebook view", () => {
    const data: NotesUIData = {
      notes: [
        { ...localNote, id: "n1", notebook: "Drafts", notebookId: "drafts" },
        { ...localNote, id: "n2", notebook: "Work", notebookId: "work" },
      ],
      notebooks: ["Drafts", "Work"],
      notebookCollections: [
        { id: "drafts", name: "Drafts" },
        { id: "work", name: "Work" },
      ],
      tags: [],
    };
    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    expect(result.current.visibleNotes.map((note) => note.id).sort()).toEqual(["n1", "n2"]);

    act(() => {
      result.current.toggleNotebookVisibility("work");
    });

    expect(result.current.hiddenNotebookIds.has("work")).toBe(true);
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["n1"]);

    act(() => {
      result.current.selectView("nb:work");
    });

    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["n2"]);
  });
});
