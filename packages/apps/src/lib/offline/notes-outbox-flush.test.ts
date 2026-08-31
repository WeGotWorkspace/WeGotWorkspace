import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import { hasNoteCollabOfflinePersistence } from "@/lib/offline/notes/notes-collab-rooms";
import {
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  readNotesBootstrapFromCache,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { flushNotesOutbox } from "@/lib/offline/notes-outbox-flush";
import { noteCollabRoomKey } from "@/lib/offline/notes/notes-collab-rooms";

const username = "bob";

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
  session: mockWorkspaceSession,
  data: {
    notes: [note],
    notebooks: ["Drafts"],
    tags: ["essay"],
  },
};

const { updateNoteItem, createNoteItem, deleteNoteItem, archiveNoteItem } = vi.hoisted(() => ({
  updateNoteItem: vi.fn(),
  createNoteItem: vi.fn(),
  deleteNoteItem: vi.fn(),
  archiveNoteItem: vi.fn(),
}));

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes")>();
  return {
    ...actual,
    updateNoteItem,
    createNoteItem,
    deleteNoteItem,
    archiveNoteItem,
  };
});

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
}));

describe("flushNotesOutbox", () => {
  beforeEach(async () => {
    updateNoteItem.mockReset();
    createNoteItem.mockReset();
    deleteNoteItem.mockReset();
    archiveNoteItem.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await writeNotesBootstrapToCache(username, bootstrap);
  });

  it("flushes a coalesced offline upsert once", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date);
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      { ...note, body: ["Updated body"] },
      note.date,
    );

    updateNoteItem.mockResolvedValue({ ...note, body: ["Updated body"] });

    const result = await flushNotesOutbox(username);
    expect(updateNoteItem).toHaveBeenCalledOnce();
    // Metadata-only PUT: the request must never carry the note body.
    const [, request] = updateNoteItem.mock.calls[0] ?? [];
    expect(request).toMatchObject({ notebook: "Drafts", tags: ["essay"] });
    expect(request).not.toHaveProperty("body");
    expect(request).not.toHaveProperty("title");
    expect(result.stateMismatches).toEqual([]);
  });

  it("reports a conflict when the server rejects a stale If-Match", async () => {
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      { ...note, body: ["Local edit"] },
      '"etag-stale"',
    );

    updateNoteItem.mockRejectedValue(Object.assign(new Error("precondition"), { status: 412 }));

    const result = await flushNotesOutbox(username);
    expect(result.stateMismatches).toEqual(["note-1"]);
    expect(updateNoteItem).toHaveBeenCalledOnce();
    expect(updateNoteItem.mock.calls[0]?.[1]).toMatchObject({ etag: '"etag-stale"' });
  });

  it("creates a server note and drops the local temp id from cache", async () => {
    const tempId = "local-offline-create";
    const offlineNote: Note = {
      ...note,
      id: tempId,
      body: ["Created offline"],
    };

    await enqueueCoalescedNoteUpdate(username, tempId, offlineNote, offlineNote.date, tempId);

    updateNoteItem.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    const saved = { ...note, id: "server-note-99", body: ["Created offline"] };
    createNoteItem.mockResolvedValue(saved);

    const result = await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledOnce();
    expect(createNoteItem).toHaveBeenCalledOnce();
    expect(result.bootstrap?.data.notes.some((row) => row.id === "server-note-99")).toBe(true);
    expect(result.bootstrap?.data.notes.some((row) => row.id === tempId)).toBe(false);
  });

  it("migrates collab persistence from temp id to saved id", async () => {
    const tempId = "local-body-id";
    const savedId = "server-body-id";
    const notebook = "Drafts";
    const tempRoom = noteCollabRoomKey(tempId);
    const ydoc = new Y.Doc();
    ydoc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
    const persistence = new IndexeddbPersistence(tempRoom, ydoc);
    await persistence.whenSynced;
    await persistence.destroy();
    ydoc.destroy();

    const offlineNote: Note = {
      ...note,
      id: tempId,
      notebook,
      body: ["Created offline body"],
    };
    await enqueueCoalescedNoteUpdate(username, tempId, offlineNote, offlineNote.date, tempId);

    updateNoteItem.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    createNoteItem.mockResolvedValue({ ...offlineNote, id: savedId });

    await flushNotesOutbox(username);

    await expect(hasNoteCollabOfflinePersistence(tempId)).resolves.toBe(false);
    await expect(hasNoteCollabOfflinePersistence(savedId)).resolves.toBe(true);
  });

  it("clears pendingSync after a successful flush", async () => {
    await upsertNoteInCache(username, { ...note, body: ["Synced body"] }, true);
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      { ...note, body: ["Synced body"] },
      note.date,
    );
    updateNoteItem.mockResolvedValue({ ...note, body: ["Synced body"] });

    await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledOnce();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await notesNotesTable(db).get("note-1");
    expect(row?.pendingSync).toBe(false);
    expect(JSON.parse(row?.data ?? "{}").body).toEqual(["Synced body"]);
  });

  it("flushes a queued delete and removes the note from cache", async () => {
    await enqueueOutboxMutation(username, {
      id: "delete-row-1",
      domain: NOTES_DOMAIN,
      op: "delete",
      payload: JSON.stringify({
        noteId: note.id,
        notebook: note.notebook,
        archived: false,
      }),
    });
    deleteNoteItem.mockResolvedValue(undefined);

    const result = await flushNotesOutbox(username);

    expect(deleteNoteItem).toHaveBeenCalledWith(note.id, {
      notebook: note.notebook,
      archived: false,
    });
    expect(result.bootstrap?.data.notes.some((row) => row.id === note.id)).toBe(false);
  });

  it("flushes an archived delete with the cached If-Match etag", async () => {
    await enqueueOutboxMutation(username, {
      id: "delete-archived-1",
      domain: NOTES_DOMAIN,
      op: "delete",
      payload: JSON.stringify({
        noteId: note.id,
        notebook: note.notebook,
        archived: true,
        etag: '"etag-archived"',
      }),
    });
    deleteNoteItem.mockResolvedValue(undefined);

    await flushNotesOutbox(username);

    expect(deleteNoteItem).toHaveBeenCalledWith(note.id, {
      notebook: note.notebook,
      archived: true,
      etag: '"etag-archived"',
    });
  });

  it("drops Dexie and outbox when a queued archive hits 404", async () => {
    await enqueueOutboxMutation(username, {
      id: "archive-row-1",
      domain: NOTES_DOMAIN,
      op: "archive",
      payload: JSON.stringify({ noteId: note.id }),
    });
    archiveNoteItem.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    const result = await flushNotesOutbox(username);

    expect(archiveNoteItem).toHaveBeenCalledOnce();
    expect(result.bootstrap?.data.notes.some((row) => row.id === note.id)).toBe(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await db.outbox.toArray()).toHaveLength(0);
    expect(await notesNotesTable(db).get(note.id)).toBeUndefined();
  });

  it("keeps a queued archive on 412 instead of dropping local", async () => {
    await enqueueOutboxMutation(username, {
      id: "archive-row-412",
      domain: NOTES_DOMAIN,
      op: "archive",
      payload: JSON.stringify({ noteId: note.id }),
    });
    archiveNoteItem.mockRejectedValue(Object.assign(new Error("precondition"), { status: 412 }));

    await flushNotesOutbox(username);

    expect((await readNotesBootstrapFromCache(username))?.data.notes[0]?.id).toBe(note.id);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await db.outbox.toArray()).toHaveLength(1);
  });

  it("replays starred upserts through REST metadata (not Drive /files/star)", async () => {
    const starredNote = { ...note, starred: true, etag: '"etag-1"' };
    await enqueueCoalescedNoteUpdate(username, starredNote.id, starredNote, starredNote.etag);
    updateNoteItem.mockResolvedValue(starredNote);

    await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledWith(
      starredNote.id,
      expect.objectContaining({ starred: true, etag: '"etag-1"' }),
    );
  });
});
