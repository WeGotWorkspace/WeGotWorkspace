import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react";
import type { MutableRefObject, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { NotesVjournalRequestError } from "@/lib/api/wgw/notes-vjournal";
import type { Note } from "@/lib/models/note";
import { createHybridNotesOperations } from "@/lib/offline/notes-hybrid-operations";
import {
  listOutboxMutations,
  readNotesBootstrapFromCache,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotebooksTable, notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { useNotesNotebookDelete } from "@/notes-core/src/use-notes-notebook-delete";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";
import { TooltipProvider } from "@/ui/tooltip";

const scratchNote: Note = {
  id: "n-scratch",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "In scratch",
  body: ["Scratch body"],
  notebook: "Scratch",
  notebookId: "notes-scratch",
  tags: [],
  wordCount: 2,
};

const keepNote: Note = {
  ...scratchNote,
  id: "n-keep",
  excerpt: "In work",
  notebook: "Work",
  notebookId: "notes-work",
};

const unsyncedScratchNote: Note = {
  ...scratchNote,
  id: "local-scratch",
  excerpt: "Not on the server yet",
};

const collections: NotesNotebookCollection[] = [
  {
    id: "notes-scratch",
    name: "Scratch",
    color: "#14b8a6",
    isSharee: false,
    isDefault: false,
    scope: "personal",
  },
  {
    id: "notes-readonly",
    name: "Read only",
    isSharee: true,
    scope: "personal",
    myRights: { mayWriteAll: false },
  },
  {
    id: "notes-ideas",
    name: "Ideas",
    isSharee: false,
    scope: "personal",
  },
  {
    id: "notes-work",
    name: "Work",
    isSharee: false,
    scope: "personal",
  },
];

function shellStub(overrides: Partial<NotesShellState> = {}): NotesShellState {
  return {
    L: defaultNotesLabels,
    operations: {
      upsertNote: vi.fn(),
      deleteNote: vi.fn(),
      archiveNote: vi.fn(),
      restoreNote: vi.fn(),
      createNotebook: vi.fn(),
      patchNotebook: vi.fn(),
      renameNotebook: vi.fn(),
      deleteNotebook: vi.fn().mockResolvedValue(undefined),
    },
    notes: [scratchNote, keepNote],
    notebooks: ["Scratch", "Ideas", "Work"],
    setNotebooks: vi.fn(),
    notebookCollections: collections,
    setNotebookCollections: vi.fn(),
    setNotes: vi.fn(),
    selectView: vi.fn(),
    view: "nb:notes-scratch",
    show: vi.fn(),
    showMutationError: vi.fn(),
    ...overrides,
  } as NotesShellState;
}

const cacheUsername = "alice";

function setBrowserOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

async function seedNotebookCache(notes: Note[]) {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(cacheUsername));
  await db.outbox.clear();
  await notesNotesTable(db).clear();
  await notesNotebooksTable(db).clear();
  await db.meta.clear();
  await writeNotesBootstrapToCache(
    cacheUsername,
    {
      session: {
        ...mockWorkspaceSession,
        user: { ...mockWorkspaceSession.user, username: cacheUsername },
      },
      data: {
        notes,
        notebooks: ["Scratch", "Ideas", "Work"],
        tags: [],
        notebookCollections: collections,
      },
    },
    Date.now(),
  );
}

function stubSelectEnv() {
  Element.prototype.scrollIntoView = vi.fn();
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
}

function notesAfter(setNotes: ReturnType<typeof vi.fn>): Note[] {
  const arg = setNotes.mock.calls.at(-1)?.[0];
  return typeof arg === "function" ? arg([scratchNote, keepNote]) : arg;
}

function DeleteHarness({
  shell,
  onFinished,
  apiRef,
}: {
  shell: NotesShellState;
  onFinished?: () => void;
  apiRef: MutableRefObject<ReturnType<typeof useNotesNotebookDelete> | null>;
}): ReactElement {
  const api = useNotesNotebookDelete({ shell, onFinished });
  apiRef.current = api;
  return <TooltipProvider delayDuration={0}>{api.notebookDeleteDialog}</TooltipProvider>;
}

describe("useNotesNotebookDelete", () => {
  beforeEach(() => {
    cleanup();
    stubSelectEnv();
    setBrowserOnline(true);
  });

  it("deletes an empty notebook in one step without a choice dialog", async () => {
    const shell = shellStub();
    const onFinished = vi.fn();
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} onFinished={onFinished} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    expect(shell.operations?.deleteNotebook).toHaveBeenCalledWith("notes-scratch", {
      kind: "purge-if-empty",
    });
    expect(screen.queryByRole("dialog", { name: "This notebook still has notes" })).toBeNull();
    expect(shell.showMutationError).not.toHaveBeenCalled();
    expect(shell.show).toHaveBeenCalledWith(defaultNotesLabels.toastNotebookDeleted("Scratch"));
    expect(shell.selectView).toHaveBeenCalledWith("all");
    expect(onFinished).toHaveBeenCalled();
    expect(notesAfter(shell.setNotes as ReturnType<typeof vi.fn>).map((note) => note.id)).toEqual([
      "n-keep",
    ]);
  });

  it("opens the choice dialog on notebookHasContents and does not toast an error", async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValue(
        new NotesVjournalRequestError("Notebook contains notes.", 409, "notebookHasContents"),
      );
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    expect(shell.showMutationError).not.toHaveBeenCalled();
    expect(shell.setNotebookCollections).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "This notebook still has notes" })).toBeTruthy();
    expect(
      screen.getByText("Pick a notebook to move them to, or delete them along with the notebook."),
    ).toBeTruthy();
  });

  it("moves notes to the picked writable notebook and toasts the destination", async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("Notebook contains notes.", 409, "notebookHasContents"),
      )
      .mockResolvedValueOnce(undefined);
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    expect(
      screen.getByRole("button", { name: "Move notes to “Ideas” and delete notebook" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox"));
    const optionNames = screen.getAllByRole("option").map((option) => option.textContent?.trim());
    expect(optionNames).toContain("Work");
    expect(optionNames).toContain("Ideas");
    expect(optionNames).not.toContain("Scratch");
    expect(optionNames).not.toContain("Read only");

    fireEvent.click(screen.getByRole("option", { name: "Work" }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Move notes to “Work” and delete notebook" }),
      );
    });

    expect(deleteNotebook).toHaveBeenLastCalledWith("notes-scratch", {
      kind: "move",
      target: "notes-work",
    });
    expect(notesAfter(shell.setNotes as ReturnType<typeof vi.fn>)).toEqual([
      expect.objectContaining({ id: "n-scratch", notebook: "Work", notebookId: "notes-work" }),
      expect.objectContaining({ id: "n-keep", notebook: "Work", notebookId: "notes-work" }),
    ]);
    expect(shell.show).toHaveBeenCalledWith("Deleted “Scratch”. Its notes moved to “Work”.");
    expect(shell.selectView).toHaveBeenCalledWith("all");
  });

  it("asks again before deleting the notes with the notebook", async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("Notebook contains notes.", 409, "notebookHasContents"),
      )
      .mockResolvedValueOnce(undefined);
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete the notes too" }));
    expect(deleteNotebook).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.dialogDelete }));
    });

    expect(deleteNotebook).toHaveBeenLastCalledWith("notes-scratch", { kind: "purge" });
    expect(notesAfter(shell.setNotes as ReturnType<typeof vi.fn>).map((note) => note.id)).toEqual([
      "n-keep",
    ]);
    expect(shell.show).toHaveBeenCalledWith(defaultNotesLabels.toastNotebookDeleted("Scratch"));
  });

  it("shows a mutation error and keeps the notebook when delete fails for another reason", async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValue(new NotesVjournalRequestError("nope", 500, "server_error"));
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const { result } = renderHook(() => useNotesNotebookDelete({ shell }));

    await act(async () => {
      await result.current.requestDeleteNotebook("notes-scratch");
    });

    expect(shell.showMutationError).toHaveBeenCalled();
    expect(shell.setNotebookCollections).not.toHaveBeenCalled();
    expect(shell.setNotes).not.toHaveBeenCalled();
    render(
      <TooltipProvider delayDuration={0}>{result.current.notebookDeleteDialog}</TooltipProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "This notebook still has notes" })).toBeNull();
  });

  it("opens the choice dialog offline when the cache has notes and queues nothing", async () => {
    await seedNotebookCache([scratchNote, keepNote]);
    await upsertNoteInCache(cacheUsername, unsyncedScratchNote, true);
    setBrowserOnline(false);

    const operations = createHybridNotesOperations(cacheUsername);
    const shell = shellStub({
      notes: [keepNote],
      operations,
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    expect(screen.getByRole("dialog", { name: "This notebook still has notes" })).toBeTruthy();
    expect(shell.show).not.toHaveBeenCalled();
    expect(shell.setNotes).not.toHaveBeenCalled();
    expect(shell.setNotebookCollections).not.toHaveBeenCalled();
    const cached = await readNotesBootstrapFromCache(cacheUsername);
    expect(cached?.data.notes.map((note) => note.id).sort()).toEqual([
      "local-scratch",
      "n-keep",
      "n-scratch",
    ]);
    const queued = await listOutboxMutations(cacheUsername);
    expect(queued.filter((row) => row.op === "deleteNotebook")).toEqual([]);
  });

  it("queues purge-if-empty for an empty offline notebook", async () => {
    await seedNotebookCache([keepNote]);
    setBrowserOnline(false);

    const operations = createHybridNotesOperations(cacheUsername);
    const shell = shellStub({
      notes: [keepNote],
      operations,
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    const queued = await listOutboxMutations(cacheUsername);
    expect(queued.map((row) => JSON.parse(row.payload) as { action?: { kind?: string } })).toEqual([
      expect.objectContaining({
        name: "notes-scratch",
        action: { kind: "purge-if-empty" },
      }),
    ]);
    const cached = await readNotesBootstrapFromCache(cacheUsername);
    expect(cached?.data.notes.map((note) => note.id)).toEqual(["n-keep"]);
    expect(shell.show).toHaveBeenCalledWith(defaultNotesLabels.toastNotebookDeleted("Scratch"));
  });

  it("surfaces a destination uid collision instead of a generic failure", async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("Notebook contains notes.", 409, "notebookHasContents"),
      )
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("A note with this UID already exists.", 409, "alreadyExists"),
      );
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Work" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Move/ }));
    });

    expect(shell.showMutationError).toHaveBeenCalledWith(
      "A note in this notebook uses the same id as another note. Pick a different notebook.",
    );
    expect(shell.setNotebookCollections).not.toHaveBeenCalled();
    expect(shell.setNotes).not.toHaveBeenCalled();
  });

  it("ignores a second confirm while the move is still running", async () => {
    let releaseMove: (() => void) | undefined;
    const deleteNotebook = vi
      .fn()
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("Notebook contains notes.", 409, "notebookHasContents"),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseMove = resolve;
          }),
      );
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Work" }));
    const confirmName = "Move notes to “Work” and delete notebook";
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: confirmName }));
    });

    const confirm = screen.getByRole("button", { name: confirmName });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(deleteNotebook).toHaveBeenCalledTimes(2);
    expect(deleteNotebook).toHaveBeenLastCalledWith("notes-scratch", {
      kind: "move",
      target: "notes-work",
    });
    await act(async () => {
      releaseMove?.();
    });
  });

  it("shows a read-only destination as its own error", async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("Notebook contains notes.", 409, "notebookHasContents"),
      )
      .mockRejectedValueOnce(
        new NotesVjournalRequestError("The destination notebook is read-only.", 403, "forbidden"),
      );
    const shell = shellStub({
      operations: { ...shellStub().operations!, deleteNotebook },
    });
    const apiRef = { current: null as ReturnType<typeof useNotesNotebookDelete> | null };
    render(<DeleteHarness shell={shell} apiRef={apiRef} />);

    await act(async () => {
      await apiRef.current?.requestDeleteNotebook("notes-scratch");
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Work" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Move/ }));
    });

    expect(shell.showMutationError).toHaveBeenCalledWith(
      "That notebook is read-only. Pick another notebook.",
    );
    expect(shell.setNotebookCollections).not.toHaveBeenCalled();
  });
});
