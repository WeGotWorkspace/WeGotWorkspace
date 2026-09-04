import { act, renderHook, waitFor } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { NOTES_VIEW_PREFS_STORAGE_KEY } from "./notes-view-prefs";
import type { NotesUIData } from "./notes-types";
import { useNotesController } from "./use-notes-controller";

const toastApi = {
  show: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
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
    expect(result.current.active?.body).toEqual(["Draft body"]);
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

  it("updates active.tags when toggleNoteTag removes a tag", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", tags: ["focus", "draft"] }],
      notebooks: ["Drafts"],
      tags: ["focus", "draft"],
    };

    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    clickSelect(result, "note-1");
    expect(result.current.active?.tags).toEqual(["focus", "draft"]);

    act(() => {
      result.current.toggleNoteTag("note-1", "focus");
    });

    expect(result.current.active?.tags).toEqual(["draft"]);
    expect(result.current.notes.find((note) => note.id === "note-1")?.tags).toEqual(["draft"]);
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

  it("keeps the new note selected and listed after the title is edited", () => {
    const data: NotesUIData = {
      notes: [],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId;
    expect(createdId).toMatch(/^local-/);

    act(() => {
      result.current.updateNote(createdId, { title: "Event" });
    });

    expect(result.current.activeId).toBe(createdId);
    expect(result.current.selectedIds).toEqual([createdId]);
    expect(result.current.active?.title).toBe("Event");
    expect(result.current.notes.find((note) => note.id === createdId)?.title).toBe("Event");
    expect(result.current.visibleNotes.map((note) => note.id)).toContain(createdId);
    expect(result.current.visibleNotes.find((note) => note.id === createdId)?.title).toBe("Event");
  });

  it("keeps the typed title selected after create remaps local-* to a server id", async () => {
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
    act(() => {
      result.current.updateNote(tempId, { title: "Event" });
    });

    const serverDate = new Date().toISOString();
    await act(async () => {
      resolveCreate({
        id: "n-server-title",
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

    expect(result.current.activeId).toBe("n-server-title");
    expect(result.current.selectedIds).toEqual(["n-server-title"]);
    expect(result.current.active?.title).toBe("Event");
    expect(result.current.notes.find((note) => note.id === "n-server-title")?.title).toBe("Event");
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["n-server-title"]);
  });

  it("does not drop a just-created titled note when bootstrap is still stale", () => {
    const data: NotesUIData = {
      notes: [],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result, rerender } = renderHook(
      ({ data, bootstrapRevision }: { data: NotesUIData; bootstrapRevision?: number }) =>
        useNotesController({ data, listLoading: false, bootstrapRevision }),
      { initialProps: { data, bootstrapRevision: 0 } },
    );

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId;
    act(() => {
      result.current.updateNote(createdId, { title: "Event" });
    });

    rerender({
      data: { notes: [], notebooks: ["Drafts"], tags: [] },
      bootstrapRevision: 1,
    });

    expect(result.current.activeId).toBe(createdId);
    expect(result.current.active?.title).toBe("Event");
    expect(result.current.notes.find((note) => note.id === createdId)?.title).toBe("Event");
    expect(result.current.visibleNotes.map((note) => note.id)).toContain(createdId);
  });

  it("does not refill SUMMARY after the user blanks the title", () => {
    const data: NotesUIData = {
      notes: [],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId!;

    act(() => {
      result.current.applyLocalBodyMarkdown(createdId, "# Meeting\n\nNotes");
    });
    expect(result.current.active?.title).toBe("Meeting");

    act(() => {
      result.current.updateNote(createdId, { title: "" });
      result.current.applyLocalBodyMarkdown(createdId, "# Meeting\n\nNotes\n\nmore");
    });
    expect(result.current.active?.title).toBe("");
  });

  it("does not copy the first body keystrokes of a new note into SUMMARY", () => {
    const data: NotesUIData = {
      notes: [],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId;

    act(() => {
      result.current.applyLocalBodyMarkdown(createdId, "Hello");
    });
    expect(result.current.active?.title).toBeUndefined();
    expect(result.current.active?.title).not.toBe("H");
    expect(result.current.active?.title).not.toBe("Hello");

    act(() => {
      result.current.updateNote(createdId, { title: "Event" });
      result.current.applyLocalBodyMarkdown(createdId, "Hello\n\nworld");
    });
    expect(result.current.active?.title).toBe("Event");
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

  it("updateNotebookCollection refreshes note list labels without a reload", async () => {
    const patchNotebook = vi.fn().mockResolvedValue({
      id: "notes-drafts",
      name: "Journal",
      color: "#14b8a6",
    });
    const data: NotesUIData = {
      notes: [
        { ...localNote, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts" },
        { ...localNote, id: "note-2", notebook: "Work", notebookId: "notes-work" },
      ],
      notebooks: ["Drafts", "Work"],
      tags: [],
      notebookCollections: [
        { id: "notes-drafts", name: "Drafts", color: "#14b8a6" },
        { id: "notes-work", name: "Work", color: "#0ea5e9" },
      ],
    };

    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        operations: {
          upsertNote: vi.fn(),
          deleteNote: vi.fn(),
          archiveNote: vi.fn(),
          restoreNote: vi.fn(),
          createNotebook: vi.fn(),
          patchNotebook,
          renameNotebook: vi.fn(),
          deleteNotebook: vi.fn(),
        },
      }),
    );

    expect(result.current.notes[0]?.notebook).toBe("Drafts");

    await act(async () => {
      await result.current.updateNotebookCollection("notes-drafts", {
        name: "Journal",
        color: null,
      });
    });

    expect(patchNotebook).toHaveBeenCalledWith("notes-drafts", { name: "Journal" });
    expect(
      result.current.notebookCollections.find((item) => item.id === "notes-drafts")?.name,
    ).toBe("Journal");
    expect(result.current.notes.find((note) => note.id === "note-1")?.notebook).toBe("Journal");
    expect(result.current.notes.find((note) => note.id === "note-2")?.notebook).toBe("Work");
    expect(result.current.notebooks).toEqual(["Journal", "Work"]);
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
      notes: [
        {
          ...localNote,
          id: "note-1",
          date: "2024-10-13T10:00:00.000Z",
          excerpt: "After sync",
          body: ["Server body"],
        },
      ],
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

  it("closeMobileDetail clears the active note so the path can drop noteId", () => {
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
      result.current.closeMobileDetail();
    });

    expect(result.current.activeId).toBe("");
    expect(onNoteChange).toHaveBeenCalledWith("");
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

  it("selects the note and writes the path on a mobile overlay viewport", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        addEventListener: vi.fn(),
        removeListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const onNoteChange = vi.fn();
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, onNoteChange }),
    );

    clickSelect(result, "note-1");

    expect(result.current.activeId).toBe("note-1");
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

  it("lists notes from isSharee notebooks on leftover shared-with-me, not Drive inbox stubs", () => {
    const data: NotesUIData = {
      notes: [
        { ...localNote, id: "owned", notebook: "Drafts", notebookId: "notes-general" },
        {
          ...localNote,
          id: "inbound",
          notebook: "Shared Notes",
          notebookId: "shared-nb",
          excerpt: "From shared notebook",
        },
        {
          ...localNote,
          id: "drive-grant",
          notebook: "TeamPad",
          sharedInbox: true,
          excerpt: "Old file grant",
        },
      ],
      notebooks: ["Drafts"],
      notebookCollections: [
        { id: "notes-general", name: "Drafts", isSharee: false },
        { id: "shared-nb", name: "Shared Notes", isSharee: true },
      ],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, initialView: "shared-with-me" }),
    );

    expect(result.current.viewLabel).toBe("Shared with me");
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["inbound"]);

    act(() => {
      result.current.selectView("nb:shared-nb");
    });
    expect(result.current.viewLabel).toBe("Shared Notes");
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["inbound"]);
  });
});

describe("useNotesController create from Starred and Archive", () => {
  const data: NotesUIData = {
    notes: [{ ...localNote, id: "note-1", starred: true }],
    notebooks: ["Drafts"],
    tags: [],
  };

  it.each(["starred", "archive"] as const)(
    "keeps New enabled from %s, switches to All Items, and creates a normal note",
    (filterView) => {
      const upsertNote = vi.fn().mockImplementation(async (note: Note) => note);
      const onViewChange = vi.fn();
      const { result } = renderHook(() =>
        useNotesController({
          data,
          listLoading: false,
          initialView: filterView,
          onViewChange,
          operations: {
            upsertNote,
            deleteNote: vi.fn(),
            archiveNote: vi.fn(),
            restoreNote: vi.fn(),
            createNotebook: vi.fn(),
            renameNotebook: vi.fn(),
            deleteNotebook: vi.fn(),
          },
        }),
      );

      expect(result.current.canCreateNote).toBe(true);
      expect(result.current.view).toBe(filterView);

      act(() => {
        result.current.createNote();
      });

      expect(result.current.view).toBe("all");
      expect(onViewChange).toHaveBeenCalledWith("all");
      const created = result.current.notes[0];
      expect(created?.id).toMatch(/^local-/);
      expect(created?.notebook).toBe("Drafts");
      expect(created?.starred).toBeFalsy();
      expect(created?.archived).toBeFalsy();
      expect(created?.tags).toEqual([]);
      expect(result.current.activeId).toBe(created?.id);
      expect(upsertNote).toHaveBeenCalledWith(
        expect.objectContaining({
          notebook: "Drafts",
          tags: [],
        }),
      );
      const payload = upsertNote.mock.calls[0]?.[0] as Note;
      expect(payload.starred).toBeFalsy();
      expect(payload.archived).toBeFalsy();
    },
  );

  it("keeps New disabled on leftover Shared with me", () => {
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, initialView: "shared-with-me" }),
    );

    expect(result.current.canCreateNote).toBe(false);
    const before = result.current.notes.length;
    act(() => {
      result.current.createNote();
    });
    expect(result.current.view).toBe("shared-with-me");
    expect(result.current.notes).toHaveLength(before);
  });
});

describe("useNotesController notebook move selection", () => {
  const notebooks = ["Drafts", "Work"] as const;
  const notebookCollections = [
    { id: "notes-drafts", name: "Drafts" },
    { id: "notes-work", name: "Work" },
  ];

  function moveData(overrides: Partial<Note> = {}): NotesUIData {
    return {
      notes: [
        {
          ...localNote,
          id: "note-1",
          notebook: "Drafts",
          notebookId: "notes-drafts",
          ...overrides,
        },
        { ...localNote, id: "note-2", notebook: "Drafts", notebookId: "notes-drafts" },
      ],
      notebooks: [...notebooks],
      notebookCollections,
      tags: ["focus"],
    };
  }

  it("keeps the same note open and switches to the destination notebook view", () => {
    const onViewChange = vi.fn();
    const data = moveData();
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        initialView: "nb:notes-drafts",
        initialNoteId: "note-1",
        onViewChange,
      }),
    );

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);

    act(() => {
      result.current.moveToNotebook(["note-1"], "Work");
    });

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
    expect(result.current.active?.id).toBe("note-1");
    expect(result.current.view).toBe("nb:notes-work");
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["note-1"]);
    expect(result.current.notes.find((note) => note.id === "note-1")).toEqual(
      expect.objectContaining({ notebook: "Work", notebookId: "notes-work" }),
    );
    expect(onViewChange).toHaveBeenCalledWith("nb:notes-work");
  });

  it("keeps the only note in a notebook selected after moving it away", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts" }],
      notebooks: [...notebooks],
      notebookCollections,
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        initialView: "nb:notes-drafts",
        initialNoteId: "note-1",
      }),
    );

    act(() => {
      result.current.moveToNotebook(["note-1"], "Work");
    });

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
    expect(result.current.view).toBe("nb:notes-work");
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["note-1"]);
  });

  it("stays on All Items with the same note selected", () => {
    const onViewChange = vi.fn();
    const data = moveData();
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        initialView: "all",
        initialNoteId: "note-1",
        onViewChange,
      }),
    );

    act(() => {
      result.current.moveToNotebook(["note-1"], "Work");
    });

    expect(result.current.view).toBe("all");
    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
    expect(result.current.visibleNotes.map((note) => note.id)).toContain("note-1");
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("stays on Starred and Tags when the moved note still belongs", () => {
    const starredData = moveData({ starred: true, tags: ["focus"] });
    const { result, rerender } = renderHook(
      ({ initialView }: { initialView: string }) =>
        useNotesController({
          data: starredData,
          listLoading: false,
          initialView,
          initialNoteId: "note-1",
        }),
      { initialProps: { initialView: "starred" } },
    );

    act(() => {
      result.current.moveToNotebook(["note-1"], "Work");
    });
    expect(result.current.view).toBe("starred");
    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);

    rerender({ initialView: "tag:focus" });
    act(() => {
      result.current.moveToNotebook(["note-1"], "Drafts");
    });
    expect(result.current.view).toBe("tag:focus");
    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
  });

  it("keeps selection when the route catches up to the destination notebook", () => {
    const data = moveData();
    const { result, rerender } = renderHook(
      ({ initialView, initialNoteId }: { initialView: string; initialNoteId: string }) =>
        useNotesController({
          data,
          listLoading: false,
          initialView,
          initialNoteId,
        }),
      { initialProps: { initialView: "nb:notes-drafts", initialNoteId: "note-1" } },
    );

    act(() => {
      result.current.moveToNotebook(["note-1"], "Work");
    });

    rerender({ initialView: "nb:notes-work", initialNoteId: "note-1" });

    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
    expect(result.current.view).toBe("nb:notes-work");
    expect(result.current.active?.id).toBe("note-1");
  });

  it("moves a group-notebook note to a writable personal notebook", () => {
    const data = moveData({
      notebook: "Specs",
      notebookId: "group-eng",
      scope: "group",
      groupSlug: "eng",
    });
    data.notebookCollections = [
      ...notebookCollections,
      { id: "group-eng", name: "Specs", scope: "group", groupSlug: "eng", isSharee: false },
    ];
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        initialView: "nb:group-eng",
        initialNoteId: "note-1",
      }),
    );

    act(() => {
      result.current.moveToNotebook(["note-1"], "notes-work");
    });

    expect(result.current.notes.find((note) => note.id === "note-1")).toEqual(
      expect.objectContaining({
        notebook: "Work",
        notebookId: "notes-work",
        scope: "personal",
      }),
    );
    expect(result.current.notes.find((note) => note.id === "note-1")?.groupSlug).toBeUndefined();
    expect(result.current.activeId).toBe("note-1");
    expect(result.current.view).toBe("nb:notes-work");
  });
});

describe("useNotesController archive persist flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(NOTES_VIEW_PREFS_STORAGE_KEY);
  });

  it("sets archived and closes detail when the open note leaves the current view", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1" }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleArchive("note-1");
    });

    expect(result.current.archived["note-1"]).toBe(true);
    expect(result.current.notes.find((note) => note.id === "note-1")?.archived).toBe(true);
    expect(result.current.activeId).toBe("");
    expect(result.current.selectedIds).toEqual([]);
  });

  it("does not select or open a note when archiving from the list without a prior selection", () => {
    const archiveNote = vi.fn().mockImplementation(async (id: string) => ({
      ...localNote,
      id,
      archived: true,
    }));
    const data: NotesUIData = {
      notes: [
        { ...localNote, id: "note-1" },
        { ...localNote, id: "note-2" },
      ],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        operations: {
          upsertNote: vi.fn(),
          deleteNote: vi.fn(),
          archiveNote,
          restoreNote: vi.fn(),
          createNotebook: vi.fn(),
          renameNotebook: vi.fn(),
          deleteNotebook: vi.fn(),
        },
      }),
    );

    expect(result.current.visibleNotes.map((note) => note.id).sort()).toEqual(["note-1", "note-2"]);

    act(() => {
      result.current.toggleArchive("note-1");
    });

    expect(result.current.archived["note-1"]).toBe(true);
    expect(result.current.notes.find((note) => note.id === "note-1")?.archived).toBe(true);
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["note-2"]);
    expect(result.current.activeId).toBe("");
    expect(result.current.selectedIds).toEqual([]);
  });

  it("shows the empty list state after archiving the last visible note", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1" }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() => useNotesController({ data, listLoading: false }));

    expect(result.current.visibleNotes).toHaveLength(1);

    act(() => {
      result.current.toggleArchive("note-1");
    });

    expect(result.current.visibleNotes).toEqual([]);
    expect(result.current.archived["note-1"]).toBe(true);
  });

  it("clears archived on unarchive and closes detail when the note leaves archive view", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", archived: true }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({
        data,
        listLoading: false,
        initialView: "archive",
      }),
    );

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleArchive("note-1");
    });

    expect(result.current.archived["note-1"]).toBeFalsy();
    expect(result.current.activeId).toBe("");
    expect(result.current.selectedIds).toEqual([]);
  });

  it("keeps archived notes out of All after a stale bootstrap refresh", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1" }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result, rerender } = renderHook(
      ({ data, bootstrapRevision }: { data: NotesUIData; bootstrapRevision?: number }) =>
        useNotesController({ data, listLoading: false, bootstrapRevision }),
      { initialProps: { data, bootstrapRevision: 0 } },
    );

    act(() => {
      result.current.toggleArchive("note-1");
    });

    rerender({
      data: {
        notes: [{ ...localNote, id: "note-1", archived: false }],
        notebooks: ["Drafts"],
        tags: [],
      },
      bootstrapRevision: 1,
    });

    expect(result.current.archived["note-1"]).toBe(true);
    expect(result.current.visibleNotes).toEqual([]);
  });

  it("keeps optimistic archived when a stale bootstrap refresh arrives", () => {
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1", archived: false }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result, rerender } = renderHook(
      ({ data, bootstrapRevision }: { data: NotesUIData; bootstrapRevision?: number }) =>
        useNotesController({ data, listLoading: false, bootstrapRevision }),
      { initialProps: { data, bootstrapRevision: 0 } },
    );

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleArchive("note-1");
    });
    expect(result.current.archived["note-1"]).toBe(true);

    rerender({
      data: {
        notes: [{ ...localNote, id: "note-1", archived: false }],
        notebooks: ["Drafts"],
        tags: [],
      },
      bootstrapRevision: 1,
    });

    expect(result.current.archived["note-1"]).toBe(true);
    expect(result.current.notes.find((note) => note.id === "note-1")?.archived).toBe(true);
  });

  it("drops the open note when archive persist returns 404", async () => {
    const operations = {
      upsertNote: vi.fn(),
      deleteNote: vi.fn(),
      archiveNote: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("Note not found"), { status: 404 })),
      restoreNote: vi.fn(),
      createNotebook: vi.fn(),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
    };
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1" }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations }),
    );

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleArchive("note-1");
    });
    expect(result.current.notes.find((note) => note.id === "note-1")).toBeTruthy();

    await waitFor(
      () => {
        expect(result.current.notes.find((note) => note.id === "note-1")).toBeUndefined();
      },
      { timeout: 4000 },
    );
    expect(result.current.archived["note-1"]).toBeUndefined();
    expect(result.current.activeId).toBe("");
    expect(result.current.selectedIds).toEqual([]);
    expect(operations.archiveNote).toHaveBeenCalledOnce();
  }, 8000);

  it("keeps the local note when archive persist returns 412", async () => {
    const operations = {
      upsertNote: vi.fn(),
      deleteNote: vi.fn(),
      archiveNote: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("precondition"), { status: 412 })),
      restoreNote: vi.fn(),
      createNotebook: vi.fn(),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
    };
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1" }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations }),
    );

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleArchive("note-1");
    });
    await waitFor(
      () => {
        expect(operations.archiveNote).toHaveBeenCalledOnce();
        expect(result.current.archived["note-1"]).toBeFalsy();
      },
      { timeout: 4000 },
    );
    expect(result.current.notes.find((note) => note.id === "note-1")).toBeTruthy();
    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
  });

  it("keeps the local note when archive persist returns 403", async () => {
    const operations = {
      upsertNote: vi.fn(),
      deleteNote: vi.fn(),
      archiveNote: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 })),
      restoreNote: vi.fn(),
      createNotebook: vi.fn(),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
    };
    const data: NotesUIData = {
      notes: [{ ...localNote, id: "note-1" }],
      notebooks: ["Drafts"],
      tags: [],
    };
    const { result } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations }),
    );

    clickSelect(result, "note-1");
    act(() => {
      result.current.toggleArchive("note-1");
    });
    await waitFor(
      () => {
        expect(operations.archiveNote).toHaveBeenCalledOnce();
        expect(result.current.archived["note-1"]).toBeFalsy();
      },
      { timeout: 4000 },
    );
    expect(result.current.notes.find((note) => note.id === "note-1")).toBeTruthy();
    expect(result.current.activeId).toBe("note-1");
    expect(result.current.selectedIds).toEqual(["note-1"]);
  });
});
