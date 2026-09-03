import { act, renderHook } from "@testing-library/react";
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
  const setView = vi.fn();
  return {
    L: {
      newNoteCategory: "Note",
      syncFailedMessage: "Sync failed",
      toastNewNote: "New note",
    } as NotesShellState["L"],
    notes: [],
    setNotes: vi.fn(),
    view: "starred",
    setView,
    searchQuery: "",
    notebooks: ["Drafts"],
    setNotebooks: vi.fn(),
    notebookCollections: [{ id: "drafts", name: "Drafts" }],
    tags: [],
    starred: {},
    applyStarToggle: vi.fn(),
    batchToggleStarForIds: vi.fn(),
    archived: {},
    setArchived: vi.fn(),
    canCreateNote: true,
    operations: {
      upsertNote: vi.fn().mockImplementation(async (note: Note) => note),
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

describe("useNotesMutations createNote", () => {
  it("uses setView (not selectView) and sets activeId before opening mobile detail", () => {
    const setView = vi.fn();
    const setNotes = vi.fn();
    const setActiveId = vi.fn();
    const selectSingle = vi.fn();
    const openMobileDetail = vi.fn();
    const shell = buildShell({ setView, setNotes });
    const list = buildList({ setActiveId, selectSingle, openMobileDetail });

    const { result } = renderHook(() => useNotesMutations({ shell, list }));

    act(() => {
      result.current.createNote();
    });

    expect(setView).toHaveBeenCalledWith("all");
    expect(setActiveId).toHaveBeenCalledWith(expect.stringMatching(/^local-/));
    expect(selectSingle).toHaveBeenCalledWith(expect.stringMatching(/^local-/));
    expect(openMobileDetail).toHaveBeenCalledWith();
    expect(setNotes).toHaveBeenCalled();
  });
});
