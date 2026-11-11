import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type {
  NotesMarkdownImportOperations,
  NotesNotebookCollection,
} from "@/notes-core/src/notes-types";
import { useNotesMarkdownImport } from "@/notes-core/src/use-notes-markdown-import";

const toastApi = {
  show: vi.fn(() => "toast-1"),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

const connection = vi.hoisted(() => ({ online: true }));
vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: () => connection.online };
});

const L = defaultNotesLabels;
const work: NotesNotebookCollection = { id: "work", name: "Work" };

function operationsMock(): NotesMarkdownImportOperations {
  return {
    createNote: vi.fn(async ({ uid, title }) => ({ id: uid, title, etag: '"1"' }) as Note),
    uploadImage: vi.fn(async () => ({ nodeId: `fn-${"c".repeat(32)}` })),
    writeBody: vi.fn(async (note) => note),
    deleteNote: vi.fn(async () => {}),
    publishNote: vi.fn(async () => {}),
    readBody: vi.fn(async (note) => ({ note, body: "" })),
  };
}

function setup(markdownImport = operationsMock()) {
  const onImported = vi.fn();
  const createNotebook = vi.fn(async (name: string) => ({ id: `nb-${name}`, name }));
  const hook = renderHook(() =>
    useNotesMarkdownImport({
      operations: { markdownImport },
      createNotebook,
      labels: L,
      onImported,
      sleep: async () => {},
    }),
  );
  return { hook, markdownImport, onImported, createNotebook };
}

describe("useNotesMarkdownImport", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
    toastApi.showError.mockClear();
    connection.online = true;
  });

  it("does not open the dialog when no Markdown file was picked", () => {
    const { hook } = setup();
    act(() => hook.result.current.beginImport([new File(["x"], "photo.png")]));
    expect(hook.result.current.importDialogOpen).toBe(false);
    expect(toastApi.showError).toHaveBeenCalledWith(L.importNoMarkdownFiles);
  });

  it("toasts and closes after a clean import, and selects the notebook", async () => {
    const { hook, onImported } = setup();
    const files = [new File(["# A"], "a.md"), new File(["# B"], "b.md")];
    act(() => hook.result.current.beginImport(files));
    expect(hook.result.current.importDialogOpen).toBe(true);

    act(() => hook.result.current.submitImport(files, { mode: "existing", notebook: work }));
    await waitFor(() => expect(hook.result.current.importBusy).toBe(false));

    expect(toastApi.show).toHaveBeenCalledWith(L.importedNotes(2), expect.anything());
    expect(onImported).toHaveBeenCalledWith(work, expect.arrayContaining([expect.anything()]));
    expect(hook.result.current.importDialogOpen).toBe(false);
  });

  it("keeps the dialog open with a result when something was skipped", async () => {
    const { hook } = setup();
    const files = [new File(["# A"], "a.md"), new File([""], "empty.md")];
    act(() => hook.result.current.beginImport(files));
    act(() => hook.result.current.submitImport(files, { mode: "existing", notebook: work }));
    await waitFor(() => expect(hook.result.current.importBusy).toBe(false));

    expect(toastApi.show).not.toHaveBeenCalled();
    expect(hook.result.current.importResult?.skipped).toEqual([
      { fileName: "empty.md", reason: "empty" },
    ]);
    expect(hook.result.current.importDialogOpen).toBe(true);
  });

  it("reuses note uids and the new notebook when Import is pressed again", async () => {
    const markdownImport = operationsMock();
    vi.mocked(markdownImport.createNote).mockRejectedValueOnce(
      Object.assign(new Error("down"), { status: 500 }),
    );
    const { hook, createNotebook } = setup(markdownImport);
    const files = [new File(["# A"], "a.md")];
    act(() => hook.result.current.beginImport(files));

    act(() => hook.result.current.submitImport(files, { mode: "create", name: "Imported" }));
    await waitFor(() => expect(hook.result.current.importResult).not.toBeNull());
    act(() => hook.result.current.submitImport(files, { mode: "create", name: "Imported" }));
    await waitFor(() => expect(toastApi.show).toHaveBeenCalled());

    const calls = vi.mocked(markdownImport.createNote).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].uid).toBe(calls[1][0].uid);
    expect(calls[1][0].notebook.id).toBe("nb-Imported");
    expect(createNotebook).toHaveBeenCalledOnce();
  });

  it("Retry leaves out files that already imported and keeps their count", async () => {
    const markdownImport = operationsMock();
    const write = vi.mocked(markdownImport.writeBody);
    write.mockImplementation(async (note) => {
      if (note.title === "B" && write.mock.calls.length === 2) {
        throw Object.assign(new Error("down"), { status: 500 });
      }
      return note;
    });
    const { hook, onImported } = setup(markdownImport);
    const a = new File(["# A\ntext a"], "a.md");
    const b = new File(["# B\ntext b"], "b.md");
    act(() => hook.result.current.beginImport([a, b]));

    act(() => hook.result.current.submitImport([a, b], { mode: "existing", notebook: work }));
    await waitFor(() => expect(hook.result.current.importResult).not.toBeNull());
    expect(hook.result.current.importResult?.imported.map((note) => note.title)).toEqual(["A"]);
    expect(markdownImport.deleteNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markdownImport.deleteNote).mock.calls[0][0].title).toBe("B");

    // Retry hands every file back; only b.md runs again.
    write.mockImplementation(async (note) => {
      if (note.title === "A") throw Object.assign(new Error("down"), { status: 500 });
      return note;
    });
    act(() => hook.result.current.submitImport([a, b], { mode: "existing", notebook: work }));
    await waitFor(() => expect(toastApi.show).toHaveBeenCalled());

    const created = vi.mocked(markdownImport.createNote).mock.calls.map((call) => call[0].title);
    expect(created).toEqual(["A", "B", "B"]);
    expect(write.mock.calls.map((call) => call[0].title)).toEqual(["A", "B", "B"]);
    expect(markdownImport.deleteNote).toHaveBeenCalledTimes(1);
    expect(toastApi.show).toHaveBeenCalledWith(L.importedNotes(2), expect.anything());
    expect(onImported).toHaveBeenCalledTimes(2);
    expect(onImported.mock.calls[1][1].map((note: Note) => note.title)).toEqual(["B"]);
  });

  it("ignores a second submit while a batch is running", async () => {
    const { hook, markdownImport } = setup();
    const files = [new File(["# A"], "a.md")];
    act(() => hook.result.current.beginImport(files));
    act(() => {
      hook.result.current.submitImport(files, { mode: "existing", notebook: work });
      hook.result.current.submitImport(files, { mode: "existing", notebook: work });
    });
    await waitFor(() => expect(hook.result.current.importBusy).toBe(false));
    expect(markdownImport.createNote).toHaveBeenCalledOnce();
  });

  it("shows an error when the new notebook could not be made", async () => {
    const { hook, createNotebook, markdownImport } = setup();
    createNotebook.mockResolvedValueOnce(undefined as never);
    const files = [new File(["# A"], "a.md")];
    act(() => hook.result.current.beginImport(files));
    act(() => hook.result.current.submitImport(files, { mode: "create", name: "X" }));
    await waitFor(() => expect(hook.result.current.importError).toBe(L.importFailed));
    expect(markdownImport.createNote).not.toHaveBeenCalled();
  });

  it("makes no notebook and tries no file when the connection dropped", async () => {
    const { hook, createNotebook, markdownImport } = setup();
    const files = [new File(["# A"], "a.md")];
    act(() => hook.result.current.beginImport(files));
    connection.online = false;

    act(() => hook.result.current.submitImport(files, { mode: "create", name: "X" }));

    expect(hook.result.current.importError).toBe(L.importOffline);
    expect(hook.result.current.importBusy).toBe(false);
    expect(createNotebook).not.toHaveBeenCalled();
    expect(markdownImport.createNote).not.toHaveBeenCalled();
  });

  it("remembers no notebook when its create failed, so Import asks the server again", async () => {
    const { hook, createNotebook, markdownImport } = setup();
    createNotebook.mockResolvedValueOnce(undefined as never);
    const files = [new File(["# A"], "a.md")];
    act(() => hook.result.current.beginImport(files));
    act(() => hook.result.current.submitImport(files, { mode: "create", name: "X" }));
    await waitFor(() => expect(hook.result.current.importError).toBe(L.importFailed));
    expect(markdownImport.createNote).not.toHaveBeenCalled();

    act(() => hook.result.current.submitImport(files, { mode: "create", name: "X" }));
    await waitFor(() => expect(hook.result.current.importBusy).toBe(false));

    expect(createNotebook).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(markdownImport.createNote).mock.calls;
    expect(calls[0]?.[0].notebook.id).toBe("nb-X");
  });
});
