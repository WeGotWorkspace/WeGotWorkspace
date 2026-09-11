import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import type { NotesUIData } from "./notes-types";
import { useNotesController } from "./use-notes-controller";

const { mockRequestConfirm, mockShow, mockShowError } = vi.hoisted(() => ({
  mockRequestConfirm: vi.fn(),
  mockShow: vi.fn(),
  mockShowError: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: mockShow,
    showError: mockShowError,
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: mockRequestConfirm,
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

const localNote: Note = {
  id: "note-1",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "Draft excerpt",
  body: ["Draft body"],
  notebook: "Drafts",
  notebookId: "notes-drafts",
  tags: [],
  wordCount: 2,
};

const notebookCollections = [
  { id: "notes-drafts", name: "Drafts" },
  { id: "notes-work", name: "Work" },
];

describe("notebook move confirm", () => {
  beforeEach(() => {
    mockRequestConfirm.mockClear();
    mockShow.mockClear();
  });

  it("requests confirm before moving the active note from the detail switcher", () => {
    const data: NotesUIData = {
      notes: [
        localNote,
        { ...localNote, id: "note-2", notebook: "Drafts", notebookId: "notes-drafts" },
      ],
      notebooks: ["Drafts", "Work"],
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
      result.current.moveActiveNoteToNotebook({ id: "notes-work", name: "Work" });
    });

    expect(mockRequestConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Move note?",
        description: "Move this note to “Work”?",
        confirmLabel: "Move",
      }),
    );
    expect(result.current.notes.find((note) => note.id === "note-1")?.notebook).toBe("Drafts");

    act(() => {
      mockRequestConfirm.mock.calls.at(-1)?.[0].onConfirm();
    });

    expect(result.current.notes.find((note) => note.id === "note-1")).toEqual(
      expect.objectContaining({ notebook: "Work", notebookId: "notes-work" }),
    );
    expect(result.current.view).toBe("nb:notes-work");
    expect(result.current.activeId).toBe("note-1");
  });

  it("does not confirm when the destination is already the active notebook", () => {
    const data: NotesUIData = {
      notes: [localNote],
      notebooks: ["Drafts", "Work"],
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
      result.current.moveActiveNoteToNotebook({ id: "notes-drafts", name: "Drafts" });
    });

    expect(mockRequestConfirm).not.toHaveBeenCalled();
  });

  it("moves immediately via moveToNotebook without confirm (batch / sidebar)", () => {
    const data: NotesUIData = {
      notes: [localNote],
      notebooks: ["Drafts", "Work"],
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

    expect(mockRequestConfirm).not.toHaveBeenCalled();
    expect(result.current.notes.find((note) => note.id === "note-1")).toEqual(
      expect.objectContaining({ notebook: "Work", notebookId: "notes-work" }),
    );
  });
});
