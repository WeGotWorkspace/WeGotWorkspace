import { act, renderHook } from "@testing-library/react";
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

function mockOperations() {
  return {
    upsertNote: vi.fn().mockImplementation(async (note: Note) => note),
    deleteNote: vi.fn(),
    archiveNote: vi.fn(),
    restoreNote: vi.fn(),
    createNotebook: vi.fn(),
    renameNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
  };
}

describe("useNotesController empty create persist", () => {
  beforeEach(() => {
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

  const data: NotesUIData = {
    notes: [],
    notebooks: ["Drafts"],
    tags: [],
  };

  it("persists an empty create and keeps it after leaving without typing", async () => {
    const operations = mockOperations();
    const { result, unmount } = renderHook(() =>
      useNotesController({ data, listLoading: false, operations }),
    );

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId;
    expect(createdId).toMatch(/^local-/);
    expect(operations.upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createdId,
        excerpt: "",
        body: [""],
        wordCount: 0,
      }),
    );
    expect(operations.upsertNote.mock.calls[0]?.[0]).not.toHaveProperty("title");

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.selectView("all");
    });

    expect(result.current.activeId).toBe("");
    expect(result.current.notes.find((note) => note.id === createdId)).toMatchObject({
      id: createdId,
      excerpt: "",
      body: [""],
    });
    expect(result.current.visibleNotes.map((note) => note.id)).toContain(createdId);
    expect(operations.deleteNote).not.toHaveBeenCalled();

    unmount();
    expect(operations.deleteNote).not.toHaveBeenCalled();
  });

  it("keeps an empty untitled create when bootstrap is still stale", () => {
    const operations = mockOperations();
    const { result, rerender } = renderHook(
      ({ data, bootstrapRevision }: { data: NotesUIData; bootstrapRevision?: number }) =>
        useNotesController({ data, listLoading: false, bootstrapRevision, operations }),
      { initialProps: { data, bootstrapRevision: 0 } },
    );

    act(() => {
      result.current.createNote();
    });
    const createdId = result.current.activeId;

    rerender({
      data: { notes: [], notebooks: ["Drafts"], tags: [] },
      bootstrapRevision: 1,
    });

    expect(result.current.notes.find((note) => note.id === createdId)?.body).toEqual([""]);
    expect(result.current.visibleNotes.map((note) => note.id)).toContain(createdId);
    expect(operations.deleteNote).not.toHaveBeenCalled();
  });
});
