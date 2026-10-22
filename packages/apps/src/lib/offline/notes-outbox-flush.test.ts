import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
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
import { upgradeLegacyLocalNotes } from "@/lib/offline/notes/notes-legacy-local-ids";

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

vi.mock("@/lib/offline/notes/notes-legacy-local-ids", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/offline/notes/notes-legacy-local-ids")>();
  return { ...actual, upgradeLegacyLocalNotes: vi.fn(actual.upgradeLegacyLocalNotes) };
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
    await writeNotesBootstrapToCache(username, bootstrap, Date.now());
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
    expect(request).toMatchObject({ tags: ["essay"] });
    // Not a move: an older queued save must not put a stale notebook back.
    expect(request).not.toHaveProperty("notebook");
    expect(request).not.toHaveProperty("body");
    expect(request).not.toHaveProperty("title");
    expect(result.stateMismatches).toEqual([]);
  });

  it("flushes a coalesced tag delta without the full tag list", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsAdd: ["focus"],
      tagsRemove: ["essay"],
    });
    updateNoteItem.mockResolvedValue({ ...note, tags: ["focus"] });

    await flushNotesOutbox(username);

    const request = updateNoteItem.mock.calls[0]?.[1];
    expect(request).toMatchObject({ tagsAdd: ["focus"], tagsRemove: ["essay"] });
    expect(request).not.toHaveProperty("tags");
    expect(request).not.toHaveProperty("body");
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
    expect(updateNoteItem).toHaveBeenCalledTimes(2);
    expect(updateNoteItem.mock.calls[0]?.[1]).toMatchObject({ etag: '"etag-stale"' });
    expect(updateNoteItem.mock.calls[1]?.[1]).not.toMatchObject({ etag: '"etag-stale"' });
  });

  it("retries a stale-etag tag upsert after create without reporting a conflict", async () => {
    const serverId = "11111111-2222-3333-4444-555555555555";
    const tagged = { ...note, id: serverId, tags: ["focus"], etag: '"etag-minted"' };
    await upsertNoteInCache(username, tagged, true);
    await enqueueCoalescedNoteUpdate(username, serverId, tagged, '"etag-stale"');

    updateNoteItem
      .mockRejectedValueOnce(Object.assign(new Error("precondition"), { status: 412 }))
      .mockResolvedValueOnce({ ...tagged, etag: '"etag-tag"' });

    const result = await flushNotesOutbox(username);
    expect(result.stateMismatches).toEqual([]);
    expect(updateNoteItem).toHaveBeenCalledTimes(2);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await notesNotesTable(db).get(serverId);
    expect(row?.pendingSync).toBe(false);
    expect(JSON.parse(row?.data ?? "{}").tags).toEqual(["focus"]);
  });

  it("creates a queued note under its own UID", async () => {
    const uid = "0ff1c0de-0000-4000-8000-000000000099";
    const offlineNote: Note = { ...note, id: uid, body: ["Created offline"], createPending: true };
    await upsertNoteInCache(username, offlineNote, true);
    await enqueueCoalescedNoteUpdate(username, uid, offlineNote, offlineNote.date, true);
    createNoteItem.mockResolvedValue({ ...note, id: uid, body: ["Created offline"] });

    const result = await flushNotesOutbox(username);

    expect(updateNoteItem).not.toHaveBeenCalled();
    expect(createNoteItem).toHaveBeenCalledWith(expect.objectContaining({ id: uid }));
    const created = result.bootstrap?.data.notes.find((row) => row.id === uid);
    expect(created?.createPending).toBeUndefined();
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
    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastStatus).toBe(412);
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

  it("a title or tag enqueue does not star and does not patch the notebook", async () => {
    const titled = {
      ...note,
      title: "Renamed",
      starred: true,
      notebookId: "notes-drafts",
      tags: ["essay", "focus"],
    };
    await enqueueCoalescedNoteUpdate(
      username,
      titled.id,
      titled,
      titled.date,
      undefined,
      { tagsAdd: ["focus"] },
      {
        includeTitle: true,
        includeTags: false,
        includeStarred: false,
        includeNotebook: false,
      },
    );
    updateNoteItem.mockResolvedValue(titled);

    await flushNotesOutbox(username);

    const request = updateNoteItem.mock.calls[0]?.[1] as {
      starred?: boolean;
      notebook?: string;
      notebookId?: string;
      title?: string;
      tagsAdd?: string[];
    };
    expect(request.title).toBe("Renamed");
    expect(request.tagsAdd).toEqual(["focus"]);
    expect(request).not.toHaveProperty("starred");
    expect(request).not.toHaveProperty("notebook");
    expect(request).not.toHaveProperty("notebookId");
  });

  it("posts notebookId for a local create that did not select a notebook move", async () => {
    const tempId = "local-create-notebook";
    const offlineNote: Note = {
      ...note,
      id: tempId,
      notebookId: "notes-drafts",
    };
    await enqueueCoalescedNoteUpdate(
      username,
      tempId,
      offlineNote,
      offlineNote.date,
      true,
      undefined,
      { includeTitle: true, includeNotebook: false },
    );
    createNoteItem.mockResolvedValue({ ...offlineNote, id: "server-note-1" });

    await flushNotesOutbox(username);

    expect(createNoteItem).toHaveBeenCalledWith(
      expect.objectContaining({ notebook: "Drafts", notebookId: "notes-drafts" }),
    );
  });

  it("runs the one-off legacy id upgrade once per page load, not on every flush", async () => {
    vi.mocked(upgradeLegacyLocalNotes).mockClear();
    await flushNotesOutbox(username);
    await flushNotesOutbox(username);

    expect(vi.mocked(upgradeLegacyLocalNotes).mock.calls.length).toBeLessThanOrEqual(1);
  });
});
