import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import type { NotesListState } from "./use-notes-list";
import type { NotesShellState } from "./use-notes-shell";
import { useNotesMutations } from "./use-notes-mutations";
import { getNoteFromCache, upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { readOfflineNotesUsername } from "@/lib/offline/offline-session";

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineNotesUsername: vi.fn(() => null),
}));

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
      createNoteFailedMessage: (notebook: string) => `Could not create a note in “${notebook}”.`,
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

  it("creates in the selected team notebook", async () => {
    const upsertNote = vi.fn().mockImplementation(async (note: Note) => note);
    const shell = buildShell({
      view: "nb:group-eng",
      notebooks: ["Drafts"],
      notebookCollections: [
        { id: "drafts", name: "Drafts" },
        { id: "group-eng", name: "Engineering", scope: "group", groupSlug: "eng" },
      ],
      operations: {
        upsertNote,
        deleteNote: vi.fn(),
        archiveNote: vi.fn(),
        restoreNote: vi.fn(),
        createNotebook: vi.fn(),
        renameNotebook: vi.fn(),
        deleteNotebook: vi.fn(),
      } as NotesShellState["operations"],
    });

    const { result } = renderHook(() => useNotesMutations({ shell, list: buildList() }));

    await act(async () => {
      result.current.createNote();
    });

    expect(upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({
        notebook: "Engineering",
        notebookId: "group-eng",
        scope: "group",
        groupSlug: "eng",
      }),
      expect.objectContaining({ onCreated: expect.any(Function) }),
    );
  });

  it("moves the open note to the server id before the post-create sync finishes", async () => {
    const saved = { id: "ad0f28e6-0000-4000-8000-000000000001" } as Note;
    const upsertNote = vi.fn(
      (note: Note, opts?: { onCreated?: (created: Note) => void }): Promise<Note> => {
        opts?.onCreated?.({ ...note, ...saved });
        return new Promise<Note>(() => undefined);
      },
    );
    const setActiveId = vi.fn();
    const shell = buildShell({
      operations: {
        ...buildShell().operations,
        upsertNote,
      } as NotesShellState["operations"],
    });

    const { result } = renderHook(() =>
      useNotesMutations({ shell, list: buildList({ setActiveId }) }),
    );

    await act(async () => {
      result.current.createNote();
    });

    const remap = setActiveId.mock.calls
      .map(([arg]) => arg)
      .find((arg) => typeof arg === "function");
    expect(remap?.(upsertNote.mock.calls[0]?.[0].id)).toBe(saved.id);
  });

  it("does not write the untitled create response over the cached server note", async () => {
    const cacheUser = "create-cache-user";
    vi.mocked(readOfflineNotesUsername).mockReturnValue(cacheUser);
    const saved = { id: "ad0f28e6-0000-4000-8000-000000000002" } as Note;
    const upsertNote = vi.fn(async (note: Note): Promise<Note> => {
      const created = { ...note, ...saved };
      // The adoption already cached the server note with the early title.
      await upsertNoteInCache(cacheUser, { ...created, title: "Ha" }, true);
      return created;
    });
    const shell = buildShell({
      operations: { ...buildShell().operations, upsertNote } as NotesShellState["operations"],
    });
    const { result } = renderHook(() => useNotesMutations({ shell, list: buildList() }));

    await act(async () => {
      result.current.createNote();
    });
    await act(async () => {
      await upsertNote.mock.results[0]?.value;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect((await getNoteFromCache(cacheUser, saved.id))?.title).toBe("Ha");
    vi.mocked(readOfflineNotesUsername).mockReturnValue(null);
  });

  it("creates in the selected personal notebook by id", async () => {
    const upsertNote = vi.fn().mockImplementation(async (note: Note) => note);
    const shell = buildShell({
      view: "nb:drafts",
      operations: {
        upsertNote,
        deleteNote: vi.fn(),
        archiveNote: vi.fn(),
        restoreNote: vi.fn(),
        createNotebook: vi.fn(),
        renameNotebook: vi.fn(),
        deleteNotebook: vi.fn(),
      } as NotesShellState["operations"],
    });

    const { result } = renderHook(() => useNotesMutations({ shell, list: buildList() }));

    await act(async () => {
      result.current.createNote();
    });

    expect(upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({
        notebook: "Drafts",
        notebookId: "drafts",
      }),
      expect.objectContaining({ onCreated: expect.any(Function) }),
    );
  });
});

describe("useNotesMutations updateNote", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const existing: Note = {
    id: "note-1",
    category: "Note",
    date: "2026-10-21T15:00:00.000Z",
    excerpt: "",
    body: [""],
    notebook: "Drafts",
    tags: [],
    wordCount: 0,
  };

  function renderWithNote() {
    const queueAutoSaveToast = vi.fn();
    const setNotes = vi.fn((update: unknown) => {
      if (typeof update === "function") update([existing]);
    });
    const shell = buildShell({
      notes: [existing],
      setNotes: setNotes as NotesShellState["setNotes"],
      queueAutoSaveToast,
    });
    const { result } = renderHook(() => useNotesMutations({ shell, list: buildList() }));
    return { result, queueAutoSaveToast };
  }

  it("shows the saved toast for a metadata edit", () => {
    const { result, queueAutoSaveToast } = renderWithNote();

    act(() => result.current.updateNote("note-1", { title: "Ha" }));

    expect(queueAutoSaveToast).toHaveBeenCalledOnce();
  });

  it("names only the title as changed, so a tag added in the debounce window is not resent", async () => {
    vi.useFakeTimers();
    const upsertNote = vi.fn(async (note: Note) => note);
    const setNotes = vi.fn((update: unknown) => {
      if (typeof update === "function") update([existing]);
    });
    const shell = buildShell({
      notes: [existing],
      setNotes: setNotes as NotesShellState["setNotes"],
      operations: { ...buildShell().operations, upsertNote } as NotesShellState["operations"],
    });
    const { result } = renderHook(() => useNotesMutations({ shell, list: buildList() }));

    act(() => result.current.updateNote("note-1", { title: "Ha" }));
    act(() => result.current.toggleNoteTag("note-1", "added-later", "add"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(upsertNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", title: "Ha" }),
      expect.objectContaining({ fields: ["title"] }),
    );
  });

  it("saves a title typed without a document without the saved toast", () => {
    const { result, queueAutoSaveToast } = renderWithNote();

    act(() => result.current.updateNote("note-1", { title: "Ha" }, { autoSaveToast: false }));

    expect(queueAutoSaveToast).not.toHaveBeenCalled();
  });
});
