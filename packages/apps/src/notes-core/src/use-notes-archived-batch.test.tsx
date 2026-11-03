import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  useConfirmDialog: () => ({ confirmDialog: null, requestConfirm: vi.fn() }),
}));

vi.mock("@/hooks/use-is-touch", () => ({ useIsTouch: () => false }));

const base: Note = {
  id: "active",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "",
  body: ["Body"],
  notebook: "Drafts",
  notebookId: "notes-drafts",
  tags: [],
  wordCount: 1,
};

const data: NotesUIData = {
  notes: [base, { ...base, id: "archived", archived: true }],
  notebooks: ["Drafts", "Work"],
  notebookCollections: [
    { id: "notes-drafts", name: "Drafts" },
    { id: "notes-work", name: "Work" },
  ],
  tags: [],
};

function renderController() {
  return renderHook(() => useNotesController({ data, listLoading: false, initialView: "all" }));
}

const noteById = (notes: Note[], id: string) => notes.find((note) => note.id === id);

describe("batch actions skip archived notes (#1535)", () => {
  it("moves only the active note when a selection includes an archived one", () => {
    const { result } = renderController();

    act(() => result.current.moveToNotebook(["active", "archived"], "notes-work"));

    expect(noteById(result.current.notes, "active")?.notebookId).toBe("notes-work");
    expect(noteById(result.current.notes, "archived")?.notebookId).toBe("notes-drafts");
  });

  it("tags only the active note", () => {
    const { result } = renderController();

    act(() => result.current.assignTagToNotes(["active", "archived"], "focus"));

    expect(noteById(result.current.notes, "active")?.tags).toEqual(["focus"]);
    expect(noteById(result.current.notes, "archived")?.tags).toEqual([]);
  });
});
