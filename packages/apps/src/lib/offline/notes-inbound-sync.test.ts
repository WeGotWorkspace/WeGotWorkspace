import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTES_NOTEBOOKS_TOKEN_KEY, syncNotesInboundFromRest } from "@/lib/offline/notes-inbound-sync";

const listNotebookChanges = vi.fn();
const listNoteChanges = vi.fn();
const getNotebook = vi.fn();
const getNote = vi.fn();
const listNotebooks = vi.fn();
const listNotes = vi.fn();
const readToken = vi.fn();
const writeToken = vi.fn();
const readCache = vi.fn();
const ingestNote = vi.fn();
const ingestNoteDestroyed = vi.fn();
const ingestNotebook = vi.fn();
const ingestNotebookDestroyed = vi.fn();

vi.mock("@/lib/api/wgw/notes-vjournal", () => ({
  listNotebookChanges: (...args: unknown[]) => listNotebookChanges(...args),
  listNoteChanges: (...args: unknown[]) => listNoteChanges(...args),
  getNotebook: (...args: unknown[]) => getNotebook(...args),
  getNote: (...args: unknown[]) => getNote(...args),
  listNotebooks: (...args: unknown[]) => listNotebooks(...args),
  listNotes: (...args: unknown[]) => listNotes(...args),
  noteFromVjournal: (row: { id: string }) => ({
    id: row.id,
    category: "Note",
    date: "—",
    excerpt: "",
    body: [""],
    notebook: "General",
    tags: [],
    wordCount: 0,
  }),
  isNotesCannotCalculateChanges: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { code?: string }).code === "cannotCalculateChanges"),
  isNotesNotFound: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { status?: number }).status === 404),
}));

vi.mock("@/lib/offline/notes-offline-store", () => ({
  readSyncToken: (...args: unknown[]) => readToken(...args),
  writeSyncToken: (...args: unknown[]) => writeToken(...args),
  readNotesBootstrapFromCache: () => readCache(),
}));

vi.mock("@/lib/offline/notes-jmap-inbound", () => ({
  ingestRemoteNote: (...args: unknown[]) => ingestNote(...args),
  ingestRemoteNoteDestroyed: (...args: unknown[]) => ingestNoteDestroyed(...args),
  ingestRemoteNotebook: (...args: unknown[]) => ingestNotebook(...args),
  ingestRemoteNotebookDestroyed: (...args: unknown[]) => ingestNotebookDestroyed(...args),
}));

describe("syncNotesInboundFromRest", () => {
  beforeEach(() => {
    listNotebookChanges.mockReset();
    listNoteChanges.mockReset();
    getNotebook.mockReset();
    getNote.mockReset();
    listNotebooks.mockReset();
    listNotes.mockReset();
    readToken.mockReset();
    writeToken.mockReset();
    readCache.mockReset();
    ingestNote.mockReset();
    ingestNoteDestroyed.mockReset();
    ingestNotebook.mockReset();
    ingestNotebookDestroyed.mockReset();
    readToken.mockResolvedValue("tok-1");
    readCache.mockResolvedValue({
      data: { notebookCollections: [{ id: "notes-general", name: "General" }], notes: [] },
    });
    ingestNote.mockResolvedValue("upserted");
    ingestNoteDestroyed.mockResolvedValue("removed");
    ingestNotebook.mockResolvedValue("upserted");
    ingestNotebookDestroyed.mockResolvedValue("removed");
  });

  it("persists tokens and GETs only changed note ids", async () => {
    listNotebookChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "tok-2",
      created: [],
      updated: [],
      destroyed: [],
    });
    listNoteChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "note-tok-2",
      created: ["n-new"],
      updated: [],
      destroyed: [],
    });
    getNote.mockResolvedValue({ id: "n-new", notebookId: "notes-general", title: "Hi", body: "", categories: [] });

    const result = await syncNotesInboundFromRest("ada");

    expect(result.usedFullResync).toBe(false);
    expect(listNotes).not.toHaveBeenCalled();
    expect(getNote).toHaveBeenCalledWith("n-new");
    expect(writeToken).toHaveBeenCalledWith("ada", NOTES_NOTEBOOKS_TOKEN_KEY, "tok-2");
    expect(writeToken).toHaveBeenCalledWith("ada", "notes-general", "note-tok-2");
  });

  it("does not destroy a note that moved into another notebook in the same poll", async () => {
    readCache.mockResolvedValue({
      data: {
        notebookCollections: [
          { id: "notes-general", name: "General" },
          { id: "notes-work", name: "Work" },
        ],
        notes: [],
      },
    });
    listNotebookChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "tok-2",
      created: [],
      updated: [],
      destroyed: [],
    });
    listNoteChanges.mockImplementation(async (notebookId: string) => {
      if (notebookId === "notes-general") {
        return {
          oldState: "tok-1",
          newState: "src-2",
          created: [],
          updated: [],
          destroyed: ["n-moved"],
        };
      }
      return {
        oldState: "tok-1",
        newState: "dst-2",
        created: ["n-moved"],
        updated: [],
        destroyed: [],
      };
    });
    getNote.mockResolvedValue({
      id: "n-moved",
      notebookId: "notes-work",
      title: "Moved",
      body: "",
      categories: [],
    });

    await syncNotesInboundFromRest("ada", ["notes-work", "notes-general"]);

    expect(getNote).toHaveBeenCalledWith("n-moved");
    expect(ingestNote).toHaveBeenCalledWith(
      "ada",
      expect.objectContaining({ id: "n-moved" }),
    );
    expect(ingestNoteDestroyed).not.toHaveBeenCalledWith("ada", "n-moved");
  });

  it("does not poll note changes for a notebook that was just destroyed", async () => {
    readCache.mockResolvedValue({
      data: { notebookCollections: [{ id: "notes-general", name: "General" }], notes: [] },
    });
    listNotebookChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "tok-2",
      created: [],
      updated: [],
      destroyed: ["notes-gone"],
    });
    listNoteChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "note-tok-2",
      created: [],
      updated: [],
      destroyed: [],
    });

    await syncNotesInboundFromRest("ada", ["notes-general", "notes-gone"]);

    expect(ingestNotebookDestroyed).toHaveBeenCalledWith("ada", "notes-gone");
    expect(listNoteChanges).toHaveBeenCalledWith("notes-general", "tok-1");
    expect(listNoteChanges).not.toHaveBeenCalledWith("notes-gone", expect.anything());
  });

  it("treats a 404 note-changes poll as a destroyed notebook", async () => {
    readCache.mockResolvedValue({
      data: {
        notebookCollections: [
          { id: "notes-general", name: "General" },
          { id: "notes-gone", name: "Gone" },
        ],
        notes: [],
      },
    });
    listNotebookChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "tok-2",
      created: [],
      updated: [],
      destroyed: [],
    });
    listNoteChanges.mockImplementation(async (notebookId: string) => {
      if (notebookId === "notes-gone") {
        throw Object.assign(new Error("gone"), { status: 404, code: "not_found" });
      }
      return {
        oldState: "tok-1",
        newState: "note-tok-2",
        created: [],
        updated: [],
        destroyed: [],
      };
    });

    await syncNotesInboundFromRest("ada");

    expect(ingestNotebookDestroyed).toHaveBeenCalledWith("ada", "notes-gone");
    expect(listNoteChanges).toHaveBeenCalledWith("notes-general", "tok-1");
  });
});
