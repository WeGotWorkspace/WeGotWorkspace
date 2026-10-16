import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { useNotesBatchActions } from "./use-notes-batch-actions";

const note: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  excerpt: "Draft",
  body: ["Body"],
  notebook: "Drafts",
  tags: [],
  wordCount: 1,
  archived: false,
};

describe("useNotesBatchActions", () => {
  it("stamps date and updatedAt the same way a single archive does", () => {
    let notes = [note];
    const setNotes = vi.fn((updater: Note[] | ((prev: Note[]) => Note[])) => {
      notes = typeof updater === "function" ? updater(notes) : updater;
    });

    const { result } = renderHook(() =>
      useNotesBatchActions({
        notes,
        setNotes,
        selectedIds: ["n-1"],
        view: "all",
        archived: {},
        setArchived: vi.fn(),
        setSelectedIds: vi.fn(),
        setSelectionMode: vi.fn(),
        operations: undefined,
        queueMutation: vi.fn(),
        dropGoneNote: vi.fn(),
        batchToggleStarForIds: vi.fn(),
        requestConfirm: vi.fn(),
        deleteConfirmCopy: {
          dialogEmptyArchiveTitle: "Empty",
          dialogDeleteItemsTitle: () => "Delete",
          dialogEmptyArchiveDescription: () => "Empty archive",
          dialogDeleteSelectedDescription: "Delete selected",
          dialogDeleteConfirmSuffix: "This cannot be undone.",
          dialogPermanentDeleteLeadIn: "Delete",
          dialogDelete: "Delete",
          dialogCancel: "Cancel",
        },
      }),
    );

    act(() => {
      result.current.batchArchive();
    });

    expect(notes[0]?.archived).toBe(true);
    expect(notes[0]?.date).not.toBe("2026-01-01T00:00:00.000Z");
    expect(notes[0]?.updatedAt).toBe(notes[0]?.date);
  });
});
