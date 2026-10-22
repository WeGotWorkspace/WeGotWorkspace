import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTES_NOTEBOOKS_TOKEN_KEY,
  syncNotesInboundFromRest,
} from "@/lib/offline/notes-inbound-sync";

const listNotebookChanges = vi.fn();
const listNoteChanges = vi.fn();
const getNotebook = vi.fn();
const getNote = vi.fn();
const listNotebooks = vi.fn();
const listNotes = vi.fn();
const readToken = vi.fn();
const writeToken = vi.fn();
const readCache = vi.fn();
const blockingIds = vi.fn<() => Promise<Set<string>>>();
const outboxIds = vi.fn<() => Promise<Set<string>>>();
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
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "cannotCalculateChanges",
    ),
  isNotesNotFound: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { status?: number }).status === 404),
}));

vi.mock("@/lib/offline/notes-offline-store", () => ({
  readSyncToken: (...args: unknown[]) => readToken(...args),
  writeSyncToken: (...args: unknown[]) => writeToken(...args),
  readNotesBootstrapFromCache: () => readCache(),
  listNoteIdsBlockingSyncToken: () => blockingIds(),
  listOutboxNoteIds: () => outboxIds(),
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
    blockingIds.mockReset();
    ingestNote.mockReset();
    ingestNoteDestroyed.mockReset();
    ingestNotebook.mockReset();
    ingestNotebookDestroyed.mockReset();
    readToken.mockResolvedValue("tok-1");
    blockingIds.mockResolvedValue(new Set());
    outboxIds.mockResolvedValue(new Set());
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
    getNote.mockResolvedValue({
      id: "n-new",
      notebookId: "notes-general",
      title: "Hi",
      body: "",
      categories: [],
    });

    const result = await syncNotesInboundFromRest("ada");

    expect(result.usedFullResync).toBe(false);
    expect(listNotes).not.toHaveBeenCalled();
    expect(getNote).toHaveBeenCalledWith("n-new");
    expect(writeToken).toHaveBeenCalledWith("ada", NOTES_NOTEBOOKS_TOKEN_KEY, "tok-2");
    expect(writeToken).toHaveBeenCalledWith("ada", "notes-general", "note-tok-2");
  });

  it("without a token, lists each notebook once and drops cached notes the server no longer has", async () => {
    readToken.mockImplementation(async (_user: string, key: string) =>
      key === NOTES_NOTEBOOKS_TOKEN_KEY ? "tok-1" : null,
    );
    listNotebookChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "tok-2",
      created: [],
      updated: [],
      destroyed: [],
    });
    listNoteChanges.mockResolvedValue({
      newState: "note-tok-9",
      created: [],
      updated: [],
      destroyed: [],
    });
    listNotes.mockResolvedValue([
      { id: "n-kept", notebookId: "notes-general", title: "Kept", body: "", categories: [] },
    ]);
    readCache.mockResolvedValue({
      data: {
        notebookCollections: [{ id: "notes-general", name: "General" }],
        notes: [
          { id: "n-kept", notebookId: "notes-general", notebook: "General" },
          { id: "n-deleted-elsewhere", notebookId: "notes-general", notebook: "General" },
        ],
      },
    });

    const result = await syncNotesInboundFromRest("ada");

    expect(result.usedFullResync).toBe(true);
    expect(listNotes).toHaveBeenCalledWith({ notebookId: "notes-general" });
    // One list, not one GET per note.
    expect(getNote).not.toHaveBeenCalled();
    expect(ingestNote).toHaveBeenCalledWith("ada", expect.objectContaining({ id: "n-kept" }));
    expect(ingestNoteDestroyed).toHaveBeenCalledWith("ada", "n-deleted-elsewhere");
    expect(ingestNoteDestroyed).not.toHaveBeenCalledWith("ada", "n-kept");
    expect(writeToken).toHaveBeenCalledWith("ada", "notes-general", "note-tok-9");
  });

  it("does not prune a note that is still queued, so it is not reported as a conflict", async () => {
    readToken.mockImplementation(async (_user: string, key: string) =>
      key === NOTES_NOTEBOOKS_TOKEN_KEY ? "tok-1" : null,
    );
    listNotebookChanges.mockResolvedValue({
      oldState: "tok-1",
      newState: "tok-2",
      created: [],
      updated: [],
      destroyed: [],
    });
    listNoteChanges.mockResolvedValue({ newState: "s", created: [], updated: [], destroyed: [] });
    listNotes.mockResolvedValue([]);
    outboxIds.mockResolvedValue(new Set(["n-in-outbox"]));
    readCache.mockResolvedValue({
      data: {
        notebookCollections: [{ id: "notes-general", name: "General" }],
        notes: [
          { id: "n-create-pending", notebookId: "notes-general", createPending: true },
          { id: "n-in-outbox", notebookId: "notes-general" },
        ],
      },
    });

    await syncNotesInboundFromRest("ada");

    expect(ingestNoteDestroyed).not.toHaveBeenCalled();
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
    expect(ingestNote).toHaveBeenCalledWith("ada", expect.objectContaining({ id: "n-moved" }));
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

  it("does not report changed when an upsert ingest skips without writing", async () => {
    blockingIds.mockResolvedValue(new Set(["n-queued-delete"]));
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
      created: [],
      updated: ["n-queued-delete"],
      destroyed: [],
    });
    getNote.mockResolvedValue({
      id: "n-queued-delete",
      notebookId: "notes-general",
      title: "Server",
      body: "",
      categories: [],
    });
    ingestNote.mockResolvedValue("skipped-pending");

    const result = await syncNotesInboundFromRest("ada");

    expect(result.changed).toBe(false);
    expect(writeToken).toHaveBeenCalledWith("ada", NOTES_NOTEBOOKS_TOKEN_KEY, "tok-2");
    expect(writeToken).not.toHaveBeenCalledWith("ada", "notes-general", "note-tok-2");
  });

  it("does not advance the sync token when a destroy is still pending", async () => {
    blockingIds.mockResolvedValue(new Set(["n-skipped"]));
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
      created: [],
      updated: [],
      destroyed: ["n-skipped"],
    });
    ingestNoteDestroyed.mockResolvedValue("skipped-pending");

    const result = await syncNotesInboundFromRest("ada");

    expect(result.changed).toBe(false);
    expect(writeToken).toHaveBeenCalledWith("ada", NOTES_NOTEBOOKS_TOKEN_KEY, "tok-2");
    expect(writeToken).not.toHaveBeenCalledWith("ada", "notes-general", "note-tok-2");
  });

  it("advances the sync token when the skipped destroy is a non-retryable stateMismatch", async () => {
    blockingIds.mockResolvedValue(new Set());
    outboxIds.mockResolvedValue(new Set());
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
      created: [],
      updated: [],
      destroyed: ["n-stuck"],
    });
    ingestNoteDestroyed.mockResolvedValue("skipped-pending");

    await syncNotesInboundFromRest("ada");

    expect(writeToken).toHaveBeenCalledWith("ada", "notes-general", "note-tok-2");
  });
});
