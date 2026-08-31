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

import {
  archiveNoteItem,
  createNoteItem,
  deleteNoteItem,
  restoreNoteItem,
  updateNoteItem,
} from "@/lib/api/wgw/notes";
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

  it("caches starred flag offline so flush can replay POST /notes/items/{id}/star", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridNotesOperations(username);
    await operations.upsertNote({ ...note, starred: true });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.starred).toBe(true);
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

  it("resolves archived flag and etag from cached note when deleting from archive", async () => {
    await upsertNoteInCache(username, { ...note, archived: true, etag: '"etag-archived"' }, false);
    vi.mocked(deleteNoteItem).mockResolvedValue(undefined);

    const operations = createHybridNotesOperations(username);
    await operations.deleteNote({ id: note.id, notebook: note.notebook });

    expect(deleteNoteItem).toHaveBeenCalledWith(
      note.id,
      { notebook: note.notebook, archived: true, etag: '"etag-archived"' },
      undefined,
    );
  });

  it("online create remaps local-* to the server uid and clears pending", async () => {
    const tempId = "local-abc123";
    const serverNote = {
      ...note,
      id: "11111111-2222-3333-4444-555555555555",
      etag: '"etag-minted"',
    };
    await upsertNoteInCache(username, { ...note, id: tempId }, true);
    vi.mocked(updateNoteItem).mockRejectedValue(
      Object.assign(new Error("Note not found"), { status: 404 }),
    );
    vi.mocked(createNoteItem).mockResolvedValue(serverNote);

    const operations = createHybridNotesOperations(username);
    const saved = await operations.upsertNote({ ...note, id: tempId });

    expect(saved.id).toBe(serverNote.id);
    expect(saved.etag).toBe('"etag-minted"');
    expect(createNoteItem).toHaveBeenCalledOnce();

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await notesNotesTable(db).get(tempId)).toBeUndefined();
    const row = await notesNotesTable(db).get(serverNote.id);
    expect(row?.pendingSync).toBe(false);
    expect(JSON.parse(row?.data ?? "{}").id).toBe(serverNote.id);
  });

  it("archives online via PATCH STATUS CANCELLED and caches archived", async () => {
    vi.mocked(archiveNoteItem).mockResolvedValue({ ...note, archived: true });

    const operations = createHybridNotesOperations(username);
    const saved = await operations.archiveNote(note.id);

    expect(archiveNoteItem).toHaveBeenCalledWith(note.id, undefined);
    expect(saved.archived).toBe(true);
    expect((await readNotesBootstrapFromCache(username))?.data.notes[0]?.archived).toBe(true);
  });

  it("restores online via PATCH STATUS FINAL and clears archived", async () => {
    await upsertNoteInCache(username, { ...note, archived: true }, false);
    vi.mocked(restoreNoteItem).mockResolvedValue({ ...note, archived: false });

    const operations = createHybridNotesOperations(username);
    const saved = await operations.restoreNote(note.id);

    expect(restoreNoteItem).toHaveBeenCalledWith(note.id, undefined);
    expect(saved.archived).toBe(false);
    expect((await readNotesBootstrapFromCache(username))?.data.notes[0]?.archived).toBeFalsy();
  });

  it("drops Dexie and outbox when archive persist returns 404", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, { ...note, starred: true }, note.date);
    vi.mocked(archiveNoteItem).mockRejectedValue(
      Object.assign(new Error("Note not found"), { status: 404 }),
    );

    const operations = createHybridNotesOperations(username);
    await expect(operations.archiveNote(note.id)).rejects.toMatchObject({ status: 404 });

    expect(await listOutboxMutations(username)).toHaveLength(0);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await notesNotesTable(db).get(note.id)).toBeUndefined();
    expect((await readNotesBootstrapFromCache(username))?.data.notes ?? []).toEqual([]);
  });

  it("keeps the Dexie row when archive persist returns 412 or 403", async () => {
    const operations = createHybridNotesOperations(username);
    vi.mocked(archiveNoteItem).mockRejectedValueOnce(
      Object.assign(new Error("precondition"), { status: 412 }),
    );
    await expect(operations.archiveNote(note.id)).rejects.toMatchObject({ status: 412 });
    expect((await readNotesBootstrapFromCache(username))?.data.notes[0]?.id).toBe(note.id);

    vi.mocked(archiveNoteItem).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    await expect(operations.archiveNote(note.id)).rejects.toMatchObject({ status: 403 });
    expect((await readNotesBootstrapFromCache(username))?.data.notes[0]?.id).toBe(note.id);
  });

  it("drops a real-UID upsert 404 instead of creating a ghost", async () => {
    vi.mocked(updateNoteItem).mockRejectedValue(
      Object.assign(new Error("Note not found"), { status: 404 }),
    );

    const operations = createHybridNotesOperations(username);
    await expect(operations.upsertNote({ ...note, title: "Gone" })).rejects.toMatchObject({
      status: 404,
    });

    expect(createNoteItem).not.toHaveBeenCalled();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await notesNotesTable(db).get(note.id)).toBeUndefined();
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

  it("keeps live notebookCollections after a Dexie cache merge", async () => {
    const { fetchNotesLiveBootstrap } = await import("@/lib/api/wgw/notes");

    await writeNotesBootstrapToCache(username, bootstrap);

    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue({
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notebooks: ["General"],
        notebookCollections: [
          { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
        ],
        groups: [{ slug: "team", displayName: "Team" }],
      },
    });

    const result = await fetchNotesHybridBootstrap();

    expect(result.data.notebookCollections).toEqual([
      { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
    ]);
    expect(result.data.groups).toEqual([{ slug: "team", displayName: "Team" }]);
    expect((await readNotesBootstrapFromCache(username))?.data.notebookCollections).toEqual([
      { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
    ]);
  });

  it("replaces Dexie ghost notebooks when the live list is empty", async () => {
    const { fetchNotesLiveBootstrap } = await import("@/lib/api/wgw/notes");

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        notes: [],
        notebooks: ["EmptyGhost", "AlsoGone"],
        tags: [],
      },
    });

    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue({
      ...bootstrap,
      data: {
        notes: [],
        notebooks: [],
        tags: [],
      },
    });

    const result = await fetchNotesHybridBootstrap();

    expect(result.data.notebooks).toEqual([]);
    // Fully empty personal tree clears Dexie rows; reader treats that as no cache.
    expect(await readNotesBootstrapFromCache(username)).toBeNull();
  });

  it("removes a notebook from Dexie after an online delete", async () => {
    const { deleteNotebook } = await import("@/lib/api/wgw/notes");
    vi.mocked(deleteNotebook).mockResolvedValue(undefined);

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        notes: [],
        notebooks: ["Drafts", "EmptyGhost"],
        tags: [],
      },
    });

    const operations = createHybridNotesOperations(username);
    await operations.deleteNotebook("EmptyGhost", { kind: "purge" });

    expect(deleteNotebook).toHaveBeenCalledWith("EmptyGhost", { mode: "purge" }, undefined);
    expect((await readNotesBootstrapFromCache(username))?.data.notebooks).toEqual(["Drafts"]);
  });

  it("drops notes in a purged notebook from Dexie after an online delete", async () => {
    const { deleteNotebook } = await import("@/lib/api/wgw/notes");
    vi.mocked(deleteNotebook).mockResolvedValue(undefined);

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        notes: [
          { ...note, id: "keep", notebook: "Drafts", notebookId: "notes-drafts" },
          { ...note, id: "gone", notebook: "Scratch", notebookId: "notes-scratch" },
        ],
        notebooks: ["Drafts", "Scratch"],
        tags: [],
        notebookCollections: [
          { id: "notes-drafts", name: "Drafts" },
          { id: "notes-scratch", name: "Scratch" },
        ],
      },
    });

    const operations = createHybridNotesOperations(username);
    await operations.deleteNotebook("Scratch", { kind: "purge" });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toEqual(["Drafts"]);
    expect(cached?.data.notes.map((item) => item.id)).toEqual(["keep"]);
  });

  it("createNotebook upserts color without dropping sibling notebooks", async () => {
    const { createNotebook } = await import("@/lib/api/wgw/notes");
    vi.mocked(createNotebook).mockResolvedValue({
      id: "notes-ideas",
      name: "Ideas",
      color: "#ec4899",
      isSharee: false,
      scope: "personal",
    });

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notebooks: ["Drafts", "General"],
        notebookCollections: [
          { id: "notes-drafts", name: "Drafts", color: "#14b8a6" },
          { id: "notes-general", name: "General", color: "#0ea5e9" },
        ],
      },
    });

    const operations = createHybridNotesOperations(username);
    const created = await operations.createNotebook("Ideas", { color: "#ec4899" });

    expect(createNotebook).toHaveBeenCalledWith("Ideas", { color: "#ec4899" });
    expect(created.color).toBe("#ec4899");
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toEqual(expect.arrayContaining(["Drafts", "General", "Ideas"]));
    expect(cached?.data.notebookCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Drafts" }),
        expect.objectContaining({ name: "General" }),
        expect.objectContaining({ name: "Ideas", color: "#ec4899" }),
      ]),
    );
  });
});
