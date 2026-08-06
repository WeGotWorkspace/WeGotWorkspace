import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
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

    rerender({ data: staleBootstrap, bootstrapRevision: 0 });
    expect(result.current.active?.tags).toEqual([]);

    rerender({ data: staleBootstrap, bootstrapRevision: 1 });
    expect(result.current.active?.tags).toEqual([]);
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
});
