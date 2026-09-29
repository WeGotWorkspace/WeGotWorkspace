import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import type { NotesListState } from "./use-notes-list";
import type { NotesShellState } from "./use-notes-shell";
import { useNotesMutations } from "./use-notes-mutations";

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
}));

function buildShell(overrides: Partial<NotesShellState> = {}): NotesShellState {
  return {
    L: {
      newNoteCategory: "Note",
      syncFailedMessage: "Sync failed",
      toastNewNote: "New note",
    } as NotesShellState["L"],
    notes: [
      {
        id: "n-1",
        category: "Note",
        date: "2026-09-29",
        updatedAt: "2026-09-29",
        excerpt: "Test note",
        body: ["Test content"],
        notebook: "Drafts",
        tags: [],
        wordCount: 2,
      } as Note,
    ],
    setNotes: vi.fn(),
    view: "all",
    setView: vi.fn(),
    searchQuery: "",
    notebooks: ["Drafts"],
    setNotebooks: vi.fn(),
    notebookCollections: [{ id: "drafts", name: "Drafts" }],
    tags: [],
    starred: {},
    applyStarToggle: vi.fn((_id: string) => true),
    batchToggleStarForIds: vi.fn(),
    archived: {},
    setArchived: vi.fn(),
    canCreateNote: true,
    operations: {
      upsertNote: vi.fn().mockResolvedValue({ id: "n-1", starred: true } as Note),
      deleteNote: vi.fn(),
      archiveNote: vi.fn(),
      restoreNote: vi.fn(),
      createNotebook: vi.fn(),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn(),
    } as NotesShellState["operations"],
    show: vi.fn(),
    showMutationError: vi.fn(),
    queueAutoSaveToast: vi.fn(),
    workspaceLayoutRef: { current: null },
    ...overrides,
  } as NotesShellState;
}

function buildList(overrides: Partial<NotesListState> = {}): NotesListState {
  return {
    selectedIds: [],
    setSelectedIds: vi.fn(),
    selectionMode: false,
    setSelectionMode: vi.fn(),
    exitSelection: vi.fn(),
    selectSingle: vi.fn(),
    queueMutation: vi.fn(),
    activeId: "",
    setActiveId: vi.fn(),
    beginOptimisticUpdate: vi.fn(),
    openMobileDetail: vi.fn(),
    closeMobileDetail: vi.fn(),
    ...overrides,
  } as NotesListState;
}

describe("useNotesMutations star toast undo", () => {
  it("shows exactly one undoable toast when starring a note", () => {
    const queueMutation = vi.fn();
    const applyStarToggle = vi.fn(() => true);
    const shell = buildShell({ applyStarToggle });
    const list = buildList({ queueMutation });

    const { result } = renderHook(() => useNotesMutations({ shell, list }));

    act(() => {
      result.current.toggleStar("n-1");
    });

    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "notes:star:n-1",
        toastMessage: "Starred",
        undoToastMessage: "Star change undone.",
      }),
    );
  });

  it("undo calls applyStarToggle and setNotes to revert the star state", () => {
    const queueMutation = vi.fn();
    const applyStarToggle = vi.fn(() => true);
    const setNotes = vi.fn();
    const shell = buildShell({ applyStarToggle, setNotes, starred: { "n-1": true } });
    const list = buildList({ queueMutation });

    const { result } = renderHook(() => useNotesMutations({ shell, list }));

    // Unstar (starred = true → false)
    act(() => {
      result.current.toggleStar("n-1");
    });

    expect(queueMutation).toHaveBeenCalledTimes(1);
    const mutationConfig = queueMutation.mock.calls[0][0];
    expect(mutationConfig.undo).toBeDefined();

    act(() => {
      mutationConfig.undo();
    });

    expect(applyStarToggle).toHaveBeenCalledWith("n-1");
    expect(setNotes).toHaveBeenCalledWith(expect.any(Function));
  });
});
