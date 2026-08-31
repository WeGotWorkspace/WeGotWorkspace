import { act, renderHook } from "@testing-library/react";
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

const draftsNote: Note = {
  id: "n1",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "Drafts excerpt",
  body: ["Drafts body"],
  notebook: "Drafts",
  notebookId: "drafts",
  tags: [],
  wordCount: 2,
};

const workNote: Note = {
  ...draftsNote,
  id: "n2",
  excerpt: "Work excerpt",
  body: ["Work body"],
  notebook: "Work",
  notebookId: "work",
};

const loadedData: NotesUIData = {
  notes: [draftsNote, workNote],
  notebooks: ["Drafts", "Work"],
  notebookCollections: [
    { id: "drafts", name: "Drafts" },
    { id: "work", name: "Work" },
  ],
  tags: [],
};

const placeholderData: NotesUIData = {
  notes: [],
  notebooks: [],
  tags: [],
};

describe("useNotesController device prefs", () => {
  beforeEach(() => {
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

  it("restores hidden notebooks from device prefs after remount", () => {
    const first = renderHook(() => useNotesController({ data: loadedData, listLoading: false }));
    act(() => {
      first.result.current.toggleNotebookVisibility("work");
    });
    expect(first.result.current.hiddenNotebookIds.has("work")).toBe(true);
    expect(first.result.current.visibleNotes.map((note) => note.id)).toEqual(["n1"]);
    first.unmount();

    const second = renderHook(() => useNotesController({ data: loadedData, listLoading: false }));
    expect(second.result.current.hiddenNotebookIds.has("work")).toBe(true);
    expect(second.result.current.visibleNotes.map((note) => note.id)).toEqual(["n1"]);
  });

  it("keeps hidden notebooks when bootstrap hydrates after an empty placeholder", () => {
    const first = renderHook(() => useNotesController({ data: loadedData, listLoading: false }));
    act(() => {
      first.result.current.toggleNotebookVisibility("work");
    });
    first.unmount();

    const { result, rerender } = renderHook(
      ({ data }: { data: NotesUIData }) => useNotesController({ data, listLoading: false }),
      { initialProps: { data: placeholderData } },
    );
    expect(result.current.hiddenNotebookIds.has("work")).toBe(true);

    rerender({ data: loadedData });
    expect(result.current.hiddenNotebookIds.has("work")).toBe(true);
    expect(result.current.visibleNotes.map((note) => note.id)).toEqual(["n1"]);
  });
});
