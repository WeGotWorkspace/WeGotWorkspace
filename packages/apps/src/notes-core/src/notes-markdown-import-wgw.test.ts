import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import type { NotesVjournalNote } from "@/lib/api/wgw/notes-vjournal";

vi.mock("@/lib/api/wgw/notes-vjournal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes-vjournal")>();
  return {
    ...actual,
    createNote: vi.fn(),
    getNote: vi.fn(),
    patchNote: vi.fn(),
    deleteNote: vi.fn(),
  };
});
vi.mock("@/lib/offline/notes-offline-store", () => ({ upsertNoteInCache: vi.fn() }));
vi.mock("@/lib/offline/notes-bootstrap-sync", () => ({ notifyNotesBootstrapUpdated: vi.fn() }));
vi.mock("@/text-editor-core/docs-collab/docs-image-upload", () => ({
  uploadNoteAttachmentImage: vi.fn(),
}));

import {
  createNote,
  deleteNote,
  getNote,
  NotesVjournalRequestError,
  patchNote,
} from "@/lib/api/wgw/notes-vjournal";
import { createWgwNotesMarkdownImport } from "@/notes-core/src/notes-markdown-import-wgw";
import { runNotesMarkdownImport } from "@/notes-core/src/notes-markdown-import-run";

const notebook: NotesNotebookCollection = { id: "work", name: "Work" };
const UID = "0b9f7c1e-3a4d-4f2b-9c8e-1d2a3b4c5d6e";

function row(over: Partial<NotesVjournalNote> = {}): NotesVjournalNote {
  return {
    id: UID,
    notebookId: "work",
    title: "A",
    body: "",
    categories: [],
    status: null,
    etag: '"e1"',
    ...over,
  };
}

const alreadyExists = () =>
  new NotesVjournalRequestError("UID already in use", 409, "alreadyExists");

function run() {
  return runNotesMarkdownImport({
    files: [new File(["# A\ntext"], "a.md", { type: "text/markdown" })],
    notebook,
    operations: createWgwNotesMarkdownImport("ann"),
    uidFor: () => UID,
    sleep: async () => undefined,
  });
}

describe("WGW Markdown import: a create retried after a lost answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries on with the note the first create made when the server answers 409", async () => {
    // The first create lands, but its answer is lost; the retry gets 409.
    vi.mocked(createNote)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(alreadyExists());
    vi.mocked(getNote).mockResolvedValue(row());
    vi.mocked(patchNote).mockImplementation(async (_id, patch) => row({ body: patch.body ?? "" }));

    const result = await run();

    expect(createNote).toHaveBeenCalledTimes(2);
    expect(getNote).toHaveBeenCalledWith(UID, expect.anything());
    expect(patchNote).toHaveBeenCalledTimes(1);
    expect(deleteNote).not.toHaveBeenCalled();
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it("leaves a note in another notebook alone and skips the file", async () => {
    vi.mocked(createNote).mockRejectedValue(alreadyExists());
    vi.mocked(getNote).mockResolvedValue(row({ notebookId: "private" }));

    const result = await run();

    expect(result.imported).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ fileName: "a.md" })]);
    expect(patchNote).not.toHaveBeenCalled();
    expect(deleteNote).not.toHaveBeenCalled();
  });
});
