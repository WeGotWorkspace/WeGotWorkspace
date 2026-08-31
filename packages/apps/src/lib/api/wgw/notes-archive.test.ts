import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesVjournalRequestError, type NotesVjournalNote } from "@/lib/api/wgw/notes-vjournal";

vi.mock("@/lib/api/wgw/notes-vjournal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes-vjournal")>();
  return {
    ...actual,
    getNote: vi.fn(),
    listNotebooks: vi.fn(),
    patchNote: vi.fn(),
    starNote: vi.fn(),
    unstarNote: vi.fn(),
    deleteNotebook: vi.fn(),
  };
});

import { deleteNotebook as deleteVjournalNotebook, getNote, listNotebooks, patchNote } from "@/lib/api/wgw/notes-vjournal";
import { archiveNoteItem, deleteNotebook, restoreNoteItem, updateNoteItem } from "@/lib/api/wgw/notes";

const notebooks = [{ id: "notes-general", name: "General" }];

const activeRow: NotesVjournalNote = {
  id: "n-1",
  notebookId: "notes-general",
  title: "Hello",
  body: "Body",
  categories: ["ideas"],
  status: null,
  etag: '"etag-1"',
};

const cancelledRow: NotesVjournalNote = {
  ...activeRow,
  status: "CANCELLED",
  etag: '"etag-2"',
};

const restoredRow: NotesVjournalNote = {
  ...activeRow,
  status: "FINAL",
  etag: '"etag-3"',
};

describe("archiveNoteItem / restoreNoteItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listNotebooks).mockResolvedValue(notebooks);
    vi.mocked(getNote).mockResolvedValue(activeRow);
  });

  it("PATCHes STATUS CANCELLED with If-Match and maps archived", async () => {
    vi.mocked(patchNote).mockResolvedValue(cancelledRow);

    const saved = await archiveNoteItem("n-1");

    expect(patchNote).toHaveBeenCalledWith(
      "n-1",
      { status: "CANCELLED" },
      expect.objectContaining({ ifMatch: '"etag-1"' }),
    );
    expect(saved.archived).toBe(true);
    expect(saved.id).toBe("n-1");
  });

  it("PATCHes STATUS FINAL with If-Match and clears archived", async () => {
    vi.mocked(getNote).mockResolvedValue(cancelledRow);
    vi.mocked(patchNote).mockResolvedValue(restoredRow);

    const saved = await restoreNoteItem("n-1");

    expect(patchNote).toHaveBeenCalledWith(
      "n-1",
      { status: "FINAL" },
      expect.objectContaining({ ifMatch: '"etag-2"' }),
    );
    expect(saved.archived).toBe(false);
  });

  it("retries archive once with a fresh If-Match after 412", async () => {
    vi.mocked(getNote)
      .mockResolvedValueOnce({ ...activeRow, etag: '"stale"' })
      .mockResolvedValueOnce({ ...activeRow, etag: '"fresh"' });
    vi.mocked(patchNote)
      .mockRejectedValueOnce(new NotesVjournalRequestError("PATCH failed (412)", 412))
      .mockResolvedValueOnce(cancelledRow);

    const saved = await archiveNoteItem("n-1");

    expect(patchNote).toHaveBeenNthCalledWith(
      1,
      "n-1",
      { status: "CANCELLED" },
      expect.objectContaining({ ifMatch: '"stale"' }),
    );
    expect(patchNote).toHaveBeenNthCalledWith(
      2,
      "n-1",
      { status: "CANCELLED" },
      expect.objectContaining({ ifMatch: '"fresh"' }),
    );
    expect(saved.archived).toBe(true);
  });
});

describe("updateNoteItem archive status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listNotebooks).mockResolvedValue(notebooks);
    vi.mocked(getNote).mockResolvedValue(cancelledRow);
    vi.mocked(patchNote).mockResolvedValue(cancelledRow);
  });

  it("does not send status so a title upsert cannot un-archive", async () => {
    await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "General",
      title: "Renamed",
      tags: ["ideas"],
      archived: false,
      etag: '"etag-2"',
    });

    const patch = vi.mocked(patchNote).mock.calls[0]?.[1];
    expect(patch).toBeDefined();
    expect(patch).not.toHaveProperty("status");
    expect(patch).toMatchObject({ title: "Renamed" });
  });

  it("PATCHes notebookId when moving and retries after 412", async () => {
    vi.mocked(listNotebooks).mockResolvedValue([
      { id: "notes-general", name: "General" },
      { id: "notes-work", name: "Work" },
    ]);
    const movedRow = { ...activeRow, notebookId: "notes-work", etag: '"etag-9"' };
    vi.mocked(getNote).mockResolvedValue({ ...activeRow, etag: '"fresh"' });
    vi.mocked(patchNote)
      .mockRejectedValueOnce(new NotesVjournalRequestError("PATCH failed (412)", 412))
      .mockResolvedValueOnce(movedRow);

    const saved = await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "Work",
      notebookId: "notes-work",
      tags: [],
      etag: '"stale"',
    });

    expect(patchNote).toHaveBeenNthCalledWith(
      1,
      "n-1",
      expect.objectContaining({ notebookId: "notes-work" }),
      expect.objectContaining({ ifMatch: '"stale"' }),
    );
    expect(patchNote).toHaveBeenNthCalledWith(
      2,
      "n-1",
      expect.objectContaining({ notebookId: "notes-work" }),
      expect.objectContaining({ ifMatch: '"fresh"' }),
    );
    expect(saved.notebookId).toBe("notes-work");
    expect(saved.notebook).toBe("Work");
  });
});

describe("deleteNotebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listNotebooks).mockResolvedValue([
      { id: "notes-scratch", name: "Scratch" },
    ]);
    vi.mocked(deleteVjournalNotebook).mockResolvedValue(undefined);
  });

  it("purges via query-param onDestroyRemoveContents", async () => {
    await deleteNotebook("Scratch", { mode: "purge" });
    expect(deleteVjournalNotebook).toHaveBeenCalledWith(
      "notes-scratch",
      expect.objectContaining({ onDestroyRemoveContents: true }),
    );
  });
});
