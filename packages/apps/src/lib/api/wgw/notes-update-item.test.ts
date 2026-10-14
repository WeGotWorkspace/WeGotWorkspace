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
  };
});

import { getNote, listNotebooks, patchNote } from "@/lib/api/wgw/notes-vjournal";
import { updateNoteItem } from "@/lib/api/wgw/notes";

const notebooks = [
  { id: "notes-general", name: "General" },
  { id: "notes-work", name: "Work" },
];

const activeRow: NotesVjournalNote = {
  id: "n-1",
  notebookId: "notes-general",
  title: "Hello",
  body: "Body",
  categories: ["focus"],
  status: null,
  etag: '"etag-1"',
};

function preconditionFailed(): NotesVjournalRequestError {
  return new NotesVjournalRequestError("PATCH failed (412)", 412);
}

describe("updateNoteItem metadata conflict retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listNotebooks).mockResolvedValue(notebooks);
    vi.mocked(getNote).mockResolvedValue(activeRow);
    vi.mocked(patchNote).mockResolvedValue(activeRow);
  });

  it("omits categories on a title-only update", async () => {
    await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "General",
      title: "Renamed",
      etag: '"etag-1"',
    });

    const patch = vi.mocked(patchNote).mock.calls[0]?.[1];
    expect(patch).toEqual({ notebookId: "notes-general", title: "Renamed" });
    expect(patch).not.toHaveProperty("categories");
    expect(getNote).not.toHaveBeenCalled();
  });

  it("unions server tags with the local set on a 412 retry", async () => {
    vi.mocked(getNote).mockResolvedValue({
      ...activeRow,
      categories: ["focus", "nieuw-van-b"],
      etag: '"fresh"',
    });
    vi.mocked(patchNote)
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce({
        ...activeRow,
        categories: ["focus", "nieuw-van-b"],
        etag: '"fresh"',
      });

    await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "General",
      title: "From A",
      tags: ["focus"],
      etag: '"stale"',
    });

    expect(patchNote).toHaveBeenNthCalledWith(
      1,
      "n-1",
      { notebookId: "notes-general", title: "From A", categories: ["focus"] },
      expect.objectContaining({ ifMatch: '"stale"' }),
    );
    expect(patchNote).toHaveBeenNthCalledWith(
      2,
      "n-1",
      {
        notebookId: "notes-general",
        title: "From A",
        categories: ["focus", "nieuw-van-b"],
      },
      expect.objectContaining({ ifMatch: '"fresh"' }),
    );
  });

  it("omits notebookId on retry when someone else moved the note", async () => {
    vi.mocked(getNote).mockResolvedValue({
      ...activeRow,
      notebookId: "notes-work",
      etag: '"fresh"',
    });
    vi.mocked(patchNote)
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce({ ...activeRow, notebookId: "notes-work", etag: '"after"' });

    await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "General",
      notebookId: "notes-general",
      title: "From A",
      tags: ["focus"],
      etag: '"stale"',
    });

    const retry = vi.mocked(patchNote).mock.calls[1]?.[1];
    expect(vi.mocked(patchNote).mock.calls[0]?.[1]).toMatchObject({
      notebookId: "notes-general",
    });
    expect(retry).not.toHaveProperty("notebookId");
    expect(retry).toMatchObject({ title: "From A", categories: ["focus"] });
  });

  it("sends the fresh ETag on the retry", async () => {
    vi.mocked(getNote).mockResolvedValue({ ...activeRow, etag: '"fresh"' });
    vi.mocked(patchNote)
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce({ ...activeRow, etag: '"fresh"' });

    await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "General",
      tags: ["focus"],
      etag: '"stale"',
    });

    expect(patchNote).toHaveBeenNthCalledWith(
      2,
      "n-1",
      expect.any(Object),
      expect.objectContaining({ ifMatch: '"fresh"' }),
    );
  });

  it("propagates a second 412 without a third PATCH", async () => {
    vi.mocked(getNote).mockResolvedValue({ ...activeRow, etag: '"fresh"' });
    vi.mocked(patchNote).mockRejectedValue(preconditionFailed());

    await expect(
      updateNoteItem("n-1", {
        id: "n-1",
        notebook: "General",
        title: "From A",
        tags: ["focus"],
        etag: '"stale"',
      }),
    ).rejects.toMatchObject({ status: 412 });
    expect(patchNote).toHaveBeenCalledTimes(2);
  });

  it("deletes a tag on a successful first attempt", async () => {
    vi.mocked(patchNote).mockResolvedValue({
      ...activeRow,
      categories: ["focus"],
      etag: '"ok"',
    });

    await updateNoteItem("n-1", {
      id: "n-1",
      notebook: "General",
      tags: ["focus"],
      etag: '"etag-1"',
    });

    expect(patchNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchNote).mock.calls[0]?.[1]).toMatchObject({ categories: ["focus"] });
    expect(getNote).not.toHaveBeenCalled();
  });
});
