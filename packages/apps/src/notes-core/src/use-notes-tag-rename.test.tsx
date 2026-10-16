import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type { Note } from "@/lib/models/note";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";
import { useNotesTagRename } from "@/notes-core/src/use-notes-tag-rename";

const toastApi = {
  show: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

function note(partial: Partial<Note> & Pick<Note, "id" | "tags">): Note {
  return {
    category: "Note",
    date: "2026-01-01T00:00:00.000Z",
    excerpt: "",
    body: [""],
    notebook: "Drafts",
    wordCount: 0,
    ...partial,
  };
}

function renderTagRename(notes: Note[], view = "all") {
  const upsertNote = vi.fn().mockImplementation(async (row: Note) => row);
  const selectView = vi.fn();
  const setNotes = vi.fn();
  const persistOptimisticNote = vi.fn().mockResolvedValue(undefined);
  const resolveNoteId = vi.fn((id: string) => id);
  const waitForInFlightCreate = vi.fn(async () => undefined);
  const dropGoneNote = vi.fn();
  const showMutationError = vi.fn();
  const shell = {
    notes,
    setNotes,
    view,
    selectView,
    operations: { upsertNote },
    showMutationError,
    L: defaultNotesLabels,
  } as unknown as NotesShellState;

  const { result } = renderHook(() => {
    const { queueMutation } = useQueuedMutation({
      delayMs: 2500,
      onMutationError: vi.fn(),
    });
    return useNotesTagRename({
      shell,
      queueMutation,
      persistOptimisticNote,
      resolveNoteId,
      waitForInFlightCreate,
      dropGoneNote,
    });
  });

  return {
    result,
    upsertNote,
    selectView,
    setNotes,
    persistOptimisticNote,
    showMutationError,
  };
}

async function flushQueue() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
}

describe("useNotesTagRename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues one add-and-remove delta per carrying note and none for the others", async () => {
    vi.useFakeTimers();
    try {
      const { result, upsertNote } = renderTagRename([
        note({ id: "yes-1", tags: ["a", "keep"] }),
        note({ id: "yes-2", tags: ["a"] }),
        note({ id: "no", tags: ["c"] }),
      ]);
      act(() => {
        result.current.renameTag("a", "b");
      });
      await flushQueue();
      expect(upsertNote).toHaveBeenCalledTimes(2);
      expect(upsertNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: "yes-1", tags: ["b", "keep"] }),
        expect.objectContaining({ tagsAdd: ["b"], tagsRemove: ["a"] }),
      );
      expect(upsertNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: "yes-2", tags: ["b"] }),
        expect.objectContaining({ tagsAdd: ["b"], tagsRemove: ["a"] }),
      );
      expect(upsertNote.mock.calls.some((call) => call[0].id === "no")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retargets tag:a to tag:b and leaves other views alone", () => {
    const active = renderTagRename([note({ id: "yes", tags: ["a"] })], "tag:a");
    act(() => {
      active.result.current.renameTag("a", "b");
    });
    expect(active.selectView).toHaveBeenCalledWith("tag:b");

    const other = renderTagRename([note({ id: "yes", tags: ["a"] })], "all");
    act(() => {
      other.result.current.renameTag("a", "b");
    });
    expect(other.selectView).not.toHaveBeenCalled();
  });

  it("names the renamed count, and the skipped count when a note is read-only", () => {
    const renamed = renderTagRename([
      note({ id: "yes-1", tags: ["a"] }),
      note({ id: "yes-2", tags: ["a"] }),
    ]);
    act(() => {
      renamed.result.current.renameTag("a", "b");
    });
    expect(toastApi.show.mock.calls[0]?.[0]).toBe("Renamed to “b” on 2 notes");

    toastApi.show.mockClear();
    const skipped = renderTagRename([
      note({ id: "yes", tags: ["a"] }),
      note({ id: "ro", tags: ["a"], sharedInbox: true, sharedBy: "bob" }),
    ]);
    act(() => {
      skipped.result.current.renameTag("a", "b");
    });
    expect(toastApi.show.mock.calls[0]?.[0]).toBe(
      "Renamed to “b” on 1 note. 1 read-only note kept the old tag.",
    );
  });

  it("undo re-queues the inverse delta and skips merged notes", async () => {
    vi.useFakeTimers();
    try {
      const { result, upsertNote } = renderTagRename([
        note({ id: "plain", tags: ["a", "keep"] }),
        note({ id: "merged", tags: ["a", "b"] }),
        note({ id: "other", tags: ["c"] }),
      ]);
      act(() => {
        result.current.renameTag("a", "b");
      });
      const onUndo = toastApi.show.mock.calls[0]?.[1]?.onUndo as (() => void) | undefined;
      expect(onUndo).toEqual(expect.any(Function));
      act(() => {
        onUndo?.();
      });
      await flushQueue();
      const inverse = upsertNote.mock.calls.filter((call) => call[1]?.tagsAdd?.[0] === "a");
      expect(inverse).toHaveLength(1);
      expect(inverse[0]?.[0]).toEqual(expect.objectContaining({ id: "plain" }));
      expect(inverse[0]?.[1]).toEqual(
        expect.objectContaining({ tagsAdd: ["a"], tagsRemove: ["b"] }),
      );
      expect(
        upsertNote.mock.calls.some(
          (call) => call[0].id === "merged" && call[1]?.tagsRemove?.[0] === "b",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
