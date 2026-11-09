import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import type {
  NotesMarkdownImportOperations,
  NotesNotebookCollection,
} from "@/notes-core/src/notes-types";
import {
  isCleanMarkdownImport,
  runNotesMarkdownImport,
} from "@/notes-core/src/notes-markdown-import-run";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const NODE_ID = `fn-${"b".repeat(32)}`;
const notebook: NotesNotebookCollection = { id: "work", name: "Work" };

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function noteFor(uid: string, title: string): Note {
  return {
    id: uid,
    notebook: "Work",
    notebookId: "work",
    title,
    etag: `"etag-${uid}"`,
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    category: "Note",
    date: "—",
  } as Note;
}

function fakeServer() {
  const calls: string[] = [];
  const notes = new Map<string, Note>();
  const operations: NotesMarkdownImportOperations = {
    createNote: vi.fn(async ({ uid, title, categories }) => {
      calls.push(`create:${title}:${categories.join(",")}`);
      const existing = notes.get(uid);
      if (existing) return existing;
      const note = noteFor(uid, title);
      notes.set(uid, note);
      return note;
    }),
    uploadImage: vi.fn(async (note, file) => {
      calls.push(`upload:${note.id}:${file.type}`);
      return { nodeId: NODE_ID };
    }),
    writeBody: vi.fn(async (note, body) => {
      calls.push(`body:${note.id}:${note.etag}`);
      const saved = { ...note, body: [body] };
      notes.set(note.id, saved);
      return saved;
    }),
  };
  return { calls, notes, operations };
}

function md(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function uidsByName() {
  const uids = new Map<File, string>();
  return (file: File) => {
    if (!uids.has(file)) uids.set(file, `uid-${file.name}`);
    return uids.get(file)!;
  };
}

const noSleep = async () => {};

describe("runNotesMarkdownImport", () => {
  it("creates the note, uploads its images, then writes the body once", async () => {
    const { calls, operations } = fakeServer();
    const progress = vi.fn();
    const result = await runNotesMarkdownImport({
      files: [
        md(
          "trip.md",
          `---\ntitle: Trip\ntags: [travel, bad tag]\n---\nSee ![map](data:image/png;base64,${PNG_1PX}) and ![local](pics/a.png)`,
        ),
      ],
      notebook,
      operations,
      uidFor: uidsByName(),
      onProgress: progress,
      sleep: noSleep,
    });

    expect(calls).toEqual([
      "create:Trip:travel",
      "upload:uid-trip.md:image/png",
      'body:uid-trip.md:"etag-uid-trip.md"',
    ]);
    expect(vi.mocked(operations.writeBody).mock.calls[0][1]).toBe(
      `See ![map](drive:${NODE_ID}) and ![local](pics/a.png)`,
    );
    expect(result.imported).toHaveLength(1);
    expect(result.droppedTags).toEqual(["bad tag"]);
    expect(result.imagesNotImported).toBe(1);
    expect(isCleanMarkdownImport(result)).toBe(false);
    expect(progress).toHaveBeenLastCalledWith({ done: 1, total: 1 });
  });

  it("skips bad files with a reason and keeps going", async () => {
    const { operations } = fakeServer();
    vi.mocked(operations.createNote).mockImplementationOnce(async () => {
      throw new HttpError(403);
    });
    const result = await runNotesMarkdownImport({
      files: [
        md("readonly.md", "# One"),
        md("empty.md", "  \n"),
        new File([new Uint8Array([0xc3, 0x28])], "latin1.md"),
        new File(["x"], "photo.png"),
        md("big.md", "x".repeat(2 * 1024 * 1024 + 1)),
        md("ok.md", "# Two\nbody"),
      ],
      notebook,
      operations,
      uidFor: uidsByName(),
      sleep: noSleep,
    });

    expect(result.imported.map((note) => note.title)).toEqual(["Two"]);
    expect(result.skipped).toEqual([
      { fileName: "readonly.md", reason: "failed", status: 403 },
      { fileName: "empty.md", reason: "empty" },
      { fileName: "latin1.md", reason: "notUtf8" },
      { fileName: "photo.png", reason: "unsupportedType" },
      { fileName: "big.md", reason: "bodyTooLarge" },
    ]);
    // Nothing is written for a file that is skipped before the create.
    expect(operations.createNote).toHaveBeenCalledTimes(2);
  });

  it("reuses the uid on retry so a network error does not duplicate the note", async () => {
    const { notes, operations } = fakeServer();
    const create = vi.mocked(operations.createNote);
    const realCreate = create.getMockImplementation()!;
    // The first create lands on the server, but its response is lost.
    create.mockImplementationOnce(async (input, opts) => {
      await realCreate(input, opts);
      throw new TypeError("Failed to fetch");
    });
    const file = md("a.md", "# A\ntext");
    const result = await runNotesMarkdownImport({
      files: [file],
      notebook,
      operations,
      uidFor: uidsByName(),
      sleep: noSleep,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].uid).toBe(create.mock.calls[1][0].uid);
    expect(notes.size).toBe(1);
    expect(result.imported).toHaveLength(1);
  });

  it("does not create a second note when the same file is imported again", async () => {
    const { notes, operations } = fakeServer();
    const file = md("a.md", "# A");
    const uidFor = uidsByName();
    await runNotesMarkdownImport({ files: [file], notebook, operations, uidFor, sleep: noSleep });
    await runNotesMarkdownImport({ files: [file], notebook, operations, uidFor, sleep: noSleep });
    expect(notes.size).toBe(1);
  });

  it("keeps the alt text when an image upload fails and still imports the note", async () => {
    const { operations } = fakeServer();
    vi.mocked(operations.uploadImage).mockRejectedValue(new HttpError(413));
    const result = await runNotesMarkdownImport({
      files: [md("a.md", `Look: ![chart](data:image/png;base64,${PNG_1PX})`)],
      notebook,
      operations,
      uidFor: uidsByName(),
      sleep: noSleep,
    });
    expect(vi.mocked(operations.writeBody).mock.calls[0][1]).toBe("Look: chart");
    expect(result.imagesNotImported).toBe(1);
    expect(result.imported).toHaveLength(1);
  });

  it("does not write a body for a note with only a title", async () => {
    const { operations } = fakeServer();
    await runNotesMarkdownImport({
      files: [md("a.md", "---\ntitle: Only\n---\n")],
      notebook,
      operations,
      uidFor: uidsByName(),
      sleep: noSleep,
    });
    expect(operations.writeBody).not.toHaveBeenCalled();
  });

  it("stops the batch when the session is gone", async () => {
    const { operations } = fakeServer();
    vi.mocked(operations.createNote).mockRejectedValue(new HttpError(401));
    const result = await runNotesMarkdownImport({
      files: [md("a.md", "a"), md("b.md", "b"), md("c.md", "c")],
      notebook,
      operations,
      uidFor: uidsByName(),
      sleep: noSleep,
    });
    expect(operations.createNote).toHaveBeenCalledTimes(1);
    expect(result.skipped.map((item) => [item.fileName, item.status])).toEqual([
      ["a.md", 401],
      ["b.md", 401],
      ["c.md", 401],
    ]);
  });

  it("is clean when every file imported with nothing to report", async () => {
    const { operations } = fakeServer();
    const result = await runNotesMarkdownImport({
      files: [md("a.md", "# A\nbody")],
      notebook,
      operations,
      uidFor: uidsByName(),
      sleep: noSleep,
    });
    expect(isCleanMarkdownImport(result)).toBe(true);
  });
});
