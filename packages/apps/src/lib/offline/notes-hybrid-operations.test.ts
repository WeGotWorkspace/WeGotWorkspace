import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  enqueueCoalescedNoteUpdate,
  listOutboxMutations,
  readNotesBootstrapFromCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable, notesNotebooksTable } from "@/lib/offline/notes/notes-schema";
import {
  createHybridNotesOperations,
  fetchNotesHybridBootstrap,
} from "@/lib/offline/notes-hybrid-operations";

const username = "alice";

const note: Note = {
  id: "note-1",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "Draft excerpt",
  body: ["Body text"],
  notebook: "Drafts",
  tags: ["essay"],
  wordCount: 2,
};

const bootstrap = {
  session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
  data: {
    notes: [note],
    notebooks: ["Drafts"],
    tags: ["essay"],
  },
};

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes")>();
  return {
    ...actual,
    updateNoteItem: vi.fn(),
    createNoteItem: vi.fn(),
    deleteNoteItem: vi.fn(),
    archiveNoteItem: vi.fn(),
    restoreNoteItem: vi.fn(),
    createNotebook: vi.fn(),
    renameNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
    fetchNotesLiveBootstrap: vi.fn(),
  };
});

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      items: [{ id: "note-1", notebook: "Drafts", updatedAt: "2024-10-12T10:00:00.000Z" }],
    }),
  }),
  wgwReadJson: vi.fn(async (res: { json: () => Promise<unknown> }) => res.json()),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  getConnectivitySnapshot: vi.fn(() => true),
  isFetchNetworkError: vi.fn((error: unknown) => {
    if (error instanceof TypeError) {
      return error.message.toLowerCase().includes("network");
    }
    return false;
  }),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

import { deleteNoteItem, updateNoteItem } from "@/lib/api/wgw/notes";
import { getConnectivitySnapshot, readBrowserOnline } from "@/lib/offline/core/browser-online";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";

describe("createHybridNotesOperations", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(getConnectivitySnapshot).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await notesNotesTable(db).clear();
    await notesNotebooksTable(db).clear();
    await db.meta.clear();
    await writeNotesBootstrapToCache(username, bootstrap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues upsert offline and updates IndexedDB when navigator.onLine is false", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridNotesOperations(username);
    const saved = await operations.upsertNote({ ...note, body: ["Offline edit"] });

    expect(saved.body).toEqual(["Offline edit"]);
    expect(updateNoteItem).not.toHaveBeenCalled();

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.body).toEqual(["Offline edit"]);

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("upsert");
  });

  it("queues upsert when live API fails with a network error", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(updateNoteItem).mockRejectedValue(new TypeError("network request failed"));

    const operations = createHybridNotesOperations(username);
    const saved = await operations.upsertNote({ ...note, body: ["Queued edit"] });

    expect(saved.body).toEqual(["Queued edit"]);
    expect(updateNoteItem).toHaveBeenCalledOnce();

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("upsert");
  });

  it("sets pendingSync on notes_notes row after offline upsert", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridNotesOperations(username);
    await operations.upsertNote({ ...note, body: ["Pending edit"] });

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await notesNotesTable(db).get("note-1");
    expect(row?.pendingSync).toBe(true);
    expect(JSON.parse(row?.data ?? "{}").body).toEqual(["Pending edit"]);
  });

  it("reuses a caller-provided local temp id for offline creates", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const tempId = "local-abc123";
    const operations = createHybridNotesOperations(username);
    const saved = await operations.upsertNote({
      id: tempId,
      category: "Note",
      date: "2024-10-12T10:00:00.000Z",
      excerpt: "",
      body: ["Offline create"],
      notebook: "Drafts",
      tags: [],
      wordCount: 0,
    });

    expect(saved.id).toBe(tempId);

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await notesNotesTable(db).get(tempId);
    expect(row?.pendingSync).toBe(true);
    expect(JSON.parse(row?.data ?? "{}").body).toEqual(["Offline create"]);

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(JSON.parse(outbox[0]?.payload ?? "{}").tempNoteId).toBe(tempId);
  });

  it("online delete clears pending upsert so flush does not recreate the note", async () => {
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      { ...note, body: ["Pending edit"] },
      note.date,
    );
    vi.mocked(deleteNoteItem).mockResolvedValue(undefined);

    const operations = createHybridNotesOperations(username);
    await operations.deleteNote(note);

    expect(deleteNoteItem).toHaveBeenCalledWith(
      note.id,
      { notebook: note.notebook, archived: false },
      undefined,
    );
    expect(await listOutboxMutations(username)).toHaveLength(0);
    expect((await readNotesBootstrapFromCache(username))?.data.notes).toHaveLength(0);
    expect(updateNoteItem).not.toHaveBeenCalled();
  });

  it("resolves archived flag from cached note when deleting from archive", async () => {
    await upsertNoteInCache(username, { ...note, archived: true }, false);
    vi.mocked(deleteNoteItem).mockResolvedValue(undefined);

    const operations = createHybridNotesOperations(username);
    await operations.deleteNote({ id: note.id, notebook: note.notebook });

    expect(deleteNoteItem).toHaveBeenCalledWith(
      note.id,
      { notebook: note.notebook, archived: true },
      undefined,
    );
  });

  it("queues delete offline and removes note from cache", async () => {
    vi.mocked(getConnectivitySnapshot).mockReturnValue(false);

    const operations = createHybridNotesOperations(username);
    await operations.deleteNote({ ...note, archived: true });

    expect(deleteNoteItem).not.toHaveBeenCalled();
    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("delete");
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toMatchObject({
      noteId: note.id,
      archived: true,
    });
    expect((await readNotesBootstrapFromCache(username))?.data.notes).toHaveLength(0);
  });
});

describe("fetchNotesHybridBootstrap", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(getConnectivitySnapshot).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await notesNotesTable(db).clear();
    await notesNotebooksTable(db).clear();
    await db.meta.clear();
    await writeNotesBootstrapToCache(username, bootstrap);
  });

  it("returns flushed cache content instead of the pre-flush live bootstrap", async () => {
    const { fetchNotesLiveBootstrap } = await import("@/lib/api/wgw/notes");

    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue({
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notes: [{ ...note, body: ["Stale server body"] }],
      },
    });
    vi.mocked(updateNoteItem).mockResolvedValue({ ...note, body: ["Flushed local body"] });
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      { ...note, body: ["Flushed local body"] },
      note.date,
    );

    const result = await fetchNotesHybridBootstrap();

    expect(result.data.notes[0]?.body).toEqual(["Flushed local body"]);
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });

  it("backfills empty cached body from server while outbox is pending", async () => {
    const { fetchNotesLiveBootstrap } = await import("@/lib/api/wgw/notes");

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notes: [{ ...note, excerpt: "", body: [""], wordCount: 0 }],
      },
    });
    await enqueueCoalescedNoteUpdate(username, note.id, { ...note, tags: ["queued"] }, note.date);

    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue({
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notes: [
          {
            ...note,
            excerpt: "Donec ullamcorper nulla non metus auctor fringilla.",
            body: ["Donec ullamcorper nulla non metus auctor fringilla."],
            wordCount: 7,
          },
        ],
      },
    });
    // Leave the outbox unflushed so hadOutbox stays true.
    vi.mocked(updateNoteItem).mockRejectedValue(new Error("offline during flush"));

    const result = await fetchNotesHybridBootstrap();

    expect(result.data.notes[0]?.body[0]).toContain("Donec ullamcorper");
    expect(result.data.notes[0]?.excerpt).toMatch(/Donec ullamcorper/);
  });

  it("keeps cached list preview when server body is empty and outbox is idle", async () => {
    const { fetchNotesLiveBootstrap } = await import("@/lib/api/wgw/notes");

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notes: [
          {
            ...note,
            excerpt: "Typed preview still in Dexie",
            body: ["Typed preview still in Dexie"],
            wordCount: 5,
            tags: ["local"],
          },
        ],
      },
    });

    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue({
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notes: [
          {
            ...note,
            excerpt: "",
            body: [""],
            wordCount: 0,
            tags: ["from-server"],
            starred: true,
          },
        ],
      },
    });

    const result = await fetchNotesHybridBootstrap();

    expect(result.data.notes[0]?.tags).toEqual(["from-server"]);
    expect(result.data.notes[0]?.starred).toBe(true);
    expect(result.data.notes[0]?.excerpt).toMatch(/Typed preview still in Dexie/);
    expect(result.data.notes[0]?.body[0]).toContain("Typed preview still in Dexie");
  });
});
