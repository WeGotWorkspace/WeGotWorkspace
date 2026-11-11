/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type { Note } from "@/lib/models/note";
import { useNotesBatchActions } from "./use-notes-batch-actions";
import { useNotesMutations } from "./use-notes-mutations";
import type { NotesAPIOperations } from "@/lib/models/notes-types";
import type { NotesListState } from "./use-notes-list";
import type { NotesShellState } from "./use-notes-shell";

const toast = vi.hoisted(() => ({
  show: vi.fn((_title: string, _options?: unknown) => "toast-1" as string | number),
  dismiss: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show: toast.show, dismiss: toast.dismiss }),
}));
vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirmDialog: null, requestConfirm: vi.fn() }),
}));
vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
}));

const NOTE: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-09-29",
  updatedAt: "2026-09-29",
  excerpt: "Test note",
  body: ["Test content"],
  notebook: "Drafts",
  notebookId: "drafts",
  tags: ["keep"],
  wordCount: 2,
};

function operationsMock() {
  return {
    upsertNote: vi.fn(async (note: Note, _opts?: unknown) => note),
    deleteNote: vi.fn(async () => undefined),
    archiveNote: vi.fn(async (id: string) => ({ ...NOTE, id, archived: true })),
    restoreNote: vi.fn(async (id: string) => ({ ...NOTE, id, archived: false })),
    createNotebook: vi.fn(),
    renameNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
  };
}

function renderNotes(operations: ReturnType<typeof operationsMock>, shellOverrides = {}) {
  const shell = {
    L: { newNoteCategory: "Note", syncFailedMessage: "Sync failed", toastNewNote: "New" },
    notes: [NOTE],
    setNotes: vi.fn(),
    view: "all",
    setView: vi.fn(),
    searchQuery: "",
    notebooks: ["Drafts", "Work"],
    setNotebooks: vi.fn(),
    notebookCollections: [
      { id: "drafts", name: "Drafts" },
      { id: "work", name: "Work" },
    ],
    tags: [],
    starred: {},
    applyStarToggle: vi.fn(() => true),
    batchToggleStarForIds: vi.fn(),
    archived: {},
    setArchived: vi.fn(),
    canCreateNote: true,
    operations: operations as unknown as NotesAPIOperations,
    show: vi.fn(),
    showMutationError: vi.fn(),
    queueAutoSaveToast: vi.fn(),
    workspaceLayoutRef: { current: null },
    ...shellOverrides,
  } as unknown as NotesShellState;
  return renderHook(() => {
    const { queueMutation, undoLatest } = useQueuedMutation({ onMutationError: vi.fn() });
    const list = {
      selectedIds: [],
      setSelectedIds: vi.fn(),
      selectionMode: false,
      setSelectionMode: vi.fn(),
      exitSelection: vi.fn(),
      selectSingle: vi.fn(),
      queueMutation,
      activeId: "",
      setActiveId: vi.fn(),
      beginOptimisticUpdate: vi.fn(() => ({ rollback: vi.fn() })),
      openMobileDetail: vi.fn(),
      closeMobileDetail: vi.fn(),
    } as unknown as NotesListState;
    return { ...useNotesMutations({ shell, list }), undoLatest };
  });
}

function undoLastToast() {
  const withUndo = toast.show.mock.calls
    .map((call) => call[1] as AppToastShowOptions | undefined)
    .filter((options) => options?.onUndo);
  act(() => withUndo.at(-1)!.onUndo!());
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  toast.show.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Notes undo as a compensating write", () => {
  it("stars right away and sends the old value back on Undo", async () => {
    const operations = operationsMock();
    const { result } = renderNotes(operations);

    act(() => result.current.toggleStar("n-1"));
    expect(operations.upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n-1", starred: true }),
      { fields: ["starred"] },
    );

    await settle();
    undoLastToast();
    await settle();

    expect(operations.upsertNote).toHaveBeenCalledTimes(2);
    expect(operations.upsertNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "n-1", starred: false }),
      { fields: ["starred"] },
    );
  });

  it("archives right away and restores on Undo", async () => {
    const operations = operationsMock();
    const { result } = renderNotes(operations);

    act(() => result.current.toggleArchive("n-1"));
    expect(operations.archiveNote).toHaveBeenCalledWith("n-1");

    await settle();
    undoLastToast();
    await settle();

    expect(operations.restoreNote).toHaveBeenCalledWith("n-1");
  });

  it("waits for a slow archive to land before it restores", async () => {
    const operations = operationsMock();
    let land!: () => void;
    operations.archiveNote.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => (land = () => resolve({ ...NOTE, id, archived: true }))),
    );
    const { result } = renderNotes(operations);

    act(() => result.current.toggleArchive("n-1"));
    undoLastToast();
    await settle();
    expect(operations.restoreNote).not.toHaveBeenCalled();

    land();
    await settle();
    expect(operations.restoreNote).toHaveBeenCalledWith("n-1");
  });

  it("moves right away and moves back to the old notebook on Undo", async () => {
    const operations = operationsMock();
    const { result } = renderNotes(operations);

    act(() => result.current.moveToNotebook(["n-1"], "work"));
    expect(operations.upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n-1", notebook: "Work", notebookId: "work" }),
      { fields: ["notebook"] },
    );

    await settle();
    undoLastToast();
    await settle();

    expect(operations.upsertNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "n-1", notebook: "Drafts", notebookId: "drafts" }),
      { fields: ["notebook"] },
    );
  });

  it("shows one toast for a move, so nothing is left after Undo", async () => {
    const shellShow = vi.fn();
    const { result } = renderNotes(operationsMock(), { show: shellShow });

    act(() => result.current.moveToNotebook(["n-1"], "work"));
    await settle();

    expect(shellShow).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith(
      "Moved 1 item to “Work”",
      expect.objectContaining({ canUndo: true }),
    );

    undoLastToast();
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
    expect(toast.show).toHaveBeenLastCalledWith("Move undone.", { severity: "info" });
  });

  it("shows one toast for a batch tag", async () => {
    const shellShow = vi.fn();
    const { result } = renderNotes(operationsMock(), { show: shellShow });

    act(() => result.current.assignTagToNotes(["n-1"], "urgent"));
    await settle();

    expect(shellShow).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledTimes(1);
    undoLastToast();
    expect(toast.show).toHaveBeenLastCalledWith("Tag assignment undone.", { severity: "info" });
  });

  it("adds a tag right away and removes only that tag on Undo", async () => {
    const operations = operationsMock();
    const { result } = renderNotes(operations);

    act(() => result.current.toggleNoteTag("n-1", "urgent"));
    expect(operations.upsertNote).toHaveBeenCalledWith(expect.objectContaining({ id: "n-1" }), {
      tagsAdd: ["urgent"],
    });

    await settle();
    undoLastToast();
    await settle();

    expect(operations.upsertNote).toHaveBeenLastCalledWith(expect.objectContaining({ id: "n-1" }), {
      tagsRemove: ["urgent"],
    });
  });

  it("puts a removed tag back on Undo", async () => {
    const operations = operationsMock();
    const { result } = renderNotes(operations);

    act(() => result.current.toggleNoteTag("n-1", "keep"));
    await settle();
    undoLastToast();
    await settle();

    expect(operations.upsertNote.mock.calls.map((call) => call[1])).toEqual([
      { tagsRemove: ["keep"] },
      { tagsAdd: ["keep"] },
    ]);
  });
});

describe("Notes delete stays deferred", () => {
  function renderBatch(operations: ReturnType<typeof operationsMock>) {
    return renderHook(() => {
      const { queueMutation } = useQueuedMutation({ onMutationError: vi.fn() });
      return useNotesBatchActions({
        notes: [NOTE],
        setNotes: vi.fn(),
        selectedIds: ["n-1"],
        view: "archive",
        archived: { "n-1": true },
        setArchived: vi.fn(),
        setSelectedIds: vi.fn(),
        setSelectionMode: vi.fn(),
        operations: operations as unknown as NotesAPIOperations,
        queueMutation,
        dropGoneNote: vi.fn(),
        batchToggleStarForIds: vi.fn(),
        requestConfirm: vi.fn((options: { onConfirm: () => void }) => options.onConfirm()),
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
      });
    });
  }

  it("waits for the grace period, and Undo cancels it", async () => {
    const operations = operationsMock();
    const { result } = renderBatch(operations);

    act(() => result.current.openDeleteConfirm(["n-1"], "selected"));
    await settle();
    expect(operations.deleteNote).not.toHaveBeenCalled();

    undoLastToast();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(operations.deleteNote).not.toHaveBeenCalled();
  });

  it("deletes after the grace period", async () => {
    const operations = operationsMock();
    const { result } = renderBatch(operations);

    act(() => result.current.openDeleteConfirm(["n-1"], "selected"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(operations.deleteNote).toHaveBeenCalledTimes(1);
  });
});

describe("Notes archive answered after Undo", () => {
  it("does not put the archive back on screen", async () => {
    const operations = operationsMock();
    let land!: () => void;
    operations.archiveNote.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => (land = () => resolve({ ...NOTE, id, archived: true }))),
    );
    const setArchived = vi.fn();
    const { result } = renderNotes(operations, { setArchived });

    act(() => result.current.toggleArchive("n-1"));
    undoLastToast();
    const callsAfterUndo = setArchived.mock.calls.length;
    land();
    await settle();

    expect(setArchived).toHaveBeenCalledTimes(callsAfterUndo);
    expect(operations.restoreNote).toHaveBeenCalledWith("n-1");
  });
});
