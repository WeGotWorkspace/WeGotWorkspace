import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesVjournalNote } from "@/lib/api/wgw/notes-vjournal";

vi.mock("@/lib/api/wgw/notes-vjournal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes-vjournal")>();
  return {
    ...actual,
    listNotebooks: vi.fn(),
    createNote: vi.fn(),
  };
});

import { createNote as createVjournalNote, listNotebooks } from "@/lib/api/wgw/notes-vjournal";
import { createNoteItem, NotesRequestError } from "@/lib/api/wgw/notes";

const createdRow: NotesVjournalNote = {
  id: "n-new",
  notebookId: "group-eng",
  title: null,
  body: "",
  categories: [],
  status: null,
  etag: '"etag-1"',
};

describe("createNoteItem notebook resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createVjournalNote).mockResolvedValue(createdRow);
  });

  it("resolves the target notebook by id", async () => {
    vi.mocked(listNotebooks).mockResolvedValue([
      { id: "group-eng", name: "Engineering", scope: "group", groupSlug: "eng" },
    ]);

    await createNoteItem({ notebookId: "group-eng", notebook: "Engineering" });

    expect(createVjournalNote).toHaveBeenCalledWith(
      expect.objectContaining({ notebookId: "group-eng" }),
      undefined,
    );
  });

  it("falls back to the display name when no id is given", async () => {
    vi.mocked(listNotebooks).mockResolvedValue([
      { id: "group-eng", name: "Engineering", scope: "group", groupSlug: "eng" },
    ]);

    await createNoteItem({ notebook: "Engineering" });

    expect(createVjournalNote).toHaveBeenCalledWith(
      expect.objectContaining({ notebookId: "group-eng" }),
      undefined,
    );
  });

  it("prefers the id over a same-named notebook", async () => {
    vi.mocked(listNotebooks).mockResolvedValue([
      { id: "notes-eng", name: "Engineering" },
      { id: "group-eng", name: "Engineering", scope: "group", groupSlug: "eng" },
    ]);

    await createNoteItem({ notebookId: "group-eng", notebook: "Engineering" });

    expect(createVjournalNote).toHaveBeenCalledWith(
      expect.objectContaining({ notebookId: "group-eng" }),
      undefined,
    );
  });

  it("throws a 404 naming the notebook when neither matches", async () => {
    vi.mocked(listNotebooks).mockResolvedValue([{ id: "notes-drafts", name: "Drafts" }]);

    await expect(
      createNoteItem({ notebookId: "group-eng", notebook: "Engineering" }),
    ).rejects.toEqual(expect.objectContaining({ status: 404 }));

    try {
      await createNoteItem({ notebookId: "group-eng", notebook: "Engineering" });
      expect.unreachable("create should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NotesRequestError);
      expect((error as NotesRequestError).message).toContain("group-eng");
      expect((error as NotesRequestError).status).toBe(404);
    }
    expect(createVjournalNote).not.toHaveBeenCalled();
  });
});
