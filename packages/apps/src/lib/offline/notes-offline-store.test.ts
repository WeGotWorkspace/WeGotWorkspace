import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { ingestRemoteNote, ingestRemoteNoteDestroyed } from "@/lib/offline/notes-jmap-inbound";
import { setNotesSyncConflictListener } from "@/lib/offline/notes-sync-conflicts";
import {
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  getNoteFromCache,
  listOutboxMutations,
  listPendingNoteFields,
  listPendingNoteIds,
  readNotesBootstrapFromCache,
  readSyncToken,
  removeNotebookFromCache,
  removeNoteFromCache,
  upsertNoteBodyPreviewInCache,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
  writeSyncToken,
} from "@/lib/offline/notes-offline-store";

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
} satisfies ReturnType<typeof createNotesAppBootstrap>;

describe("notes offline store", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await notesNotesTable(db).clear();
    await writeNotesBootstrapToCache(username, bootstrap, Date.now());
    await db.outbox.clear();
  });

  it("reads bootstrap written to cache", async () => {
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.body).toEqual(["Body text"]);
  });

  it("persists notebook color and does not drop sibling collections on upsert", async () => {
    const { upsertNotebookInCache } = await import("@/lib/offline/notes-offline-store");
    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          ...bootstrap.data,
          notebooks: ["Drafts", "General"],
          notebookCollections: [
            { id: "notes-drafts", name: "Drafts", color: "#14b8a6" },
            { id: "notes-general", name: "General", color: "#0ea5e9" },
          ],
        },
      },
      Date.now(),
    );

    await upsertNotebookInCache(username, {
      id: "notes-ideas",
      name: "Ideas",
      color: "#ec4899",
      isSharee: false,
      scope: "personal",
    });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toEqual(expect.arrayContaining(["Drafts", "General", "Ideas"]));
    expect(cached?.data.notebookCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Drafts", color: "#14b8a6" }),
        expect.objectContaining({ name: "General", color: "#0ea5e9" }),
        expect.objectContaining({ name: "Ideas", color: "#ec4899" }),
      ]),
    );
  });

  it("persists notebookCollections and groups for edit/save", async () => {
    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          ...bootstrap.data,
          notebooks: ["General"],
          notebookCollections: [
            { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
          ],
          groups: [{ slug: "team", displayName: "Team" }],
        },
      },
      Date.now(),
    );

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebookCollections).toEqual([
      { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
    ]);
    expect(cached?.data.groups).toEqual([{ slug: "team", displayName: "Team" }]);
  });

  it("rewrites cached note.notebook when a collection is renamed", async () => {
    const { upsertNotebookInCache } = await import("@/lib/offline/notes-offline-store");
    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          notes: [
            { ...note, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts" },
            { ...note, id: "note-2", notebook: "Work", notebookId: "notes-work" },
          ],
          notebooks: ["Drafts", "Work"],
          tags: ["essay"],
          notebookCollections: [
            { id: "notes-drafts", name: "Drafts", color: "#14b8a6" },
            { id: "notes-work", name: "Work", color: "#0ea5e9" },
          ],
        },
      },
      Date.now(),
    );

    await upsertNotebookInCache(username, {
      id: "notes-drafts",
      name: "Journal",
      color: "#14b8a6",
      isSharee: false,
      scope: "personal",
    });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toEqual(["Journal", "Work"]);
    expect(cached?.data.notes.map((item) => ({ id: item.id, notebook: item.notebook }))).toEqual([
      { id: "note-1", notebook: "Journal" },
      { id: "note-2", notebook: "Work" },
    ]);
    expect(cached?.data.notebookCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "notes-drafts", name: "Journal" }),
        expect.objectContaining({ id: "notes-work", name: "Work" }),
      ]),
    );
  });

  it("drops a notebook and its synced notes from Dexie", async () => {
    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          notes: [
            { ...note, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts" },
            { ...note, id: "note-2", notebook: "Work", notebookId: "notes-work" },
          ],
          notebooks: ["Drafts", "Work"],
          tags: ["essay"],
          notebookCollections: [
            { id: "notes-drafts", name: "Drafts" },
            { id: "notes-work", name: "Work" },
          ],
        },
      },
      Date.now(),
    );

    await removeNotebookFromCache(username, "notes-drafts", { keepPendingNotes: false });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toEqual(["Work"]);
    expect(cached?.data.notes.map((item) => item.id)).toEqual(["note-2"]);
    expect(cached?.data.notebookCollections).toEqual([
      expect.objectContaining({ id: "notes-work", name: "Work" }),
    ]);
  });

  it("keeps pending notes when a remote notebook destroy is ingested", async () => {
    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          notes: [{ ...note, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts" }],
          notebooks: ["Drafts"],
          tags: ["essay"],
          notebookCollections: [{ id: "notes-drafts", name: "Drafts" }],
        },
      },
      Date.now(),
    );
    await upsertNoteInCache(
      username,
      { ...note, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts", title: "Local" },
      true,
    );

    await removeNotebookFromCache(username, "notes-drafts");

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes).toEqual([expect.objectContaining({ id: "note-1", title: "Local" })]);
  });

  it("rewrites notes to the destination, including pending rows, and drops both sync tokens", async () => {
    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          notes: [
            { ...note, id: "note-1", notebook: "Drafts", notebookId: "notes-drafts" },
            { ...note, id: "note-2", notebook: "Work", notebookId: "notes-work" },
          ],
          notebooks: ["Drafts", "Work"],
          tags: ["essay"],
          notebookCollections: [
            { id: "notes-drafts", name: "Drafts", scope: "personal" },
            { id: "notes-work", name: "Work", scope: "personal" },
          ],
        },
      },
      Date.now(),
    );
    await upsertNoteInCache(
      username,
      {
        ...note,
        id: "note-pending",
        notebook: "Drafts",
        notebookId: "notes-drafts",
        title: "Pending",
      },
      true,
    );
    await writeSyncToken(username, "notes-drafts", "src-token");
    await writeSyncToken(username, "notes-work", "dst-token");

    await removeNotebookFromCache(username, "notes-drafts", {
      moveNotesTo: { id: "notes-work", name: "Work", scope: "personal" },
    });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toEqual(["Work"]);
    expect(cached?.data.notebookCollections).toEqual([
      expect.objectContaining({ id: "notes-work", name: "Work" }),
    ]);
    expect(
      cached?.data.notes.map((item) => ({
        id: item.id,
        notebook: item.notebook,
        notebookId: item.notebookId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: "note-1", notebook: "Work", notebookId: "notes-work" },
        { id: "note-2", notebook: "Work", notebookId: "notes-work" },
        { id: "note-pending", notebook: "Work", notebookId: "notes-work" },
      ]),
    );
    expect(cached?.data.notes).toHaveLength(3);
    expect(await readSyncToken(username, "notes-drafts")).toBeNull();
    expect(await readSyncToken(username, "notes-work")).toBeNull();
  });

  it("preserves pendingSync notes when bootstrap is rewritten from server", async () => {
    const localNote = { ...note, body: ["Local body"] };
    await upsertNoteInCache(username, localNote, true);

    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          ...bootstrap.data,
          notes: [{ ...note, body: ["Server body"] }],
        },
      },
      Date.now(),
    );

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.body).toEqual(["Local body"]);
  });

  it("backfills empty pending body from server so list previews are not Untitled", async () => {
    const emptyLocal = { ...note, excerpt: "", body: [""], wordCount: 0, tags: ["pending"] };
    await upsertNoteInCache(username, emptyLocal, true);

    await writeNotesBootstrapToCache(
      username,
      {
        ...bootstrap,
        data: {
          ...bootstrap.data,
          notes: [
            {
              ...note,
              excerpt: "Donec ullamcorper nulla non metus auctor fringilla.",
              body: ["Donec ullamcorper nulla non metus auctor fringilla."],
              tags: ["server"],
              wordCount: 7,
            },
          ],
        },
      },
      Date.now(),
    );

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.tags).toEqual(["pending"]);
    expect(cached?.data.notes[0]?.body[0]).toContain("Donec ullamcorper");
    expect(cached?.data.notes[0]?.excerpt).toMatch(/Donec ullamcorper/);
  });

  it("coalesces pending upsert rows for the same note", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date);
    await enqueueCoalescedNoteUpdate(
      username,
      note.id,
      { ...note, tags: ["merged", "essay"] },
      note.date,
    );

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.op).toBe("upsert");
    const payload = JSON.parse(rows[0]?.payload ?? "{}");
    expect(payload.metadata.tags).toEqual(["merged", "essay"]);
    // Body is never coalesced into the metadata outbox.
    expect(payload).not.toHaveProperty("note");
    expect(payload.metadata).not.toHaveProperty("body");
  });

  it("unions queued tag deltas and lets a later remove win", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsAdd: ["focus"],
    });
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsAdd: ["v2"],
      tagsRemove: ["focus"],
    });

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as {
      metadata: { tags?: string[]; tagsAdd?: string[]; tagsRemove?: string[] };
    };
    expect(payload.metadata.tagsAdd).toEqual(["v2"]);
    expect(payload.metadata.tagsRemove).toEqual(["focus"]);
    expect(payload.metadata.tags).toBeUndefined();
  });

  it("keeps an add idempotent when the same tag is queued twice", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsAdd: ["focus"],
    });
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsAdd: ["Focus"],
    });

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as { metadata: { tagsAdd?: string[] } };
    expect(payload.metadata.tagsAdd).toEqual(["focus"]);
  });

  it("keeps a remove idempotent when the same tag is queued twice", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsRemove: ["focus"],
    });
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date, undefined, {
      tagsRemove: ["focus"],
    });

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as {
      metadata: { tagsRemove?: string[]; tagsAdd?: string[] };
    };
    expect(payload.metadata.tagsRemove).toEqual(["focus"]);
    expect(payload.metadata.tagsAdd).toBeUndefined();
  });

  it("preserves pendingSync when updating a body preview", async () => {
    await upsertNoteInCache(username, note, false);
    await upsertNoteBodyPreviewInCache(username, {
      ...note,
      body: ["Hydrated body"],
      excerpt: "Hydrated body",
    });

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await notesNotesTable(db).get(note.id);
    expect(row?.pendingSync).toBe(false);
    expect(JSON.parse(row?.data ?? "{}").body).toEqual(["Hydrated body"]);
    expect(await listPendingNoteIds(username)).toEqual([]);
  });

  it("keeps metadata-pending notes pending after a body preview write", async () => {
    await upsertNoteInCache(username, note, true);
    await upsertNoteBodyPreviewInCache(username, {
      ...note,
      body: ["Still pending metadata"],
    });

    expect(await listPendingNoteIds(username)).toEqual([note.id]);
  });

  it("does not resurrect a remapped local-* row from a body preview write", async () => {
    const tempId = "local-c55e3aa68b224beab477053dfeb10efd";
    const serverId = "11111111-2222-3333-4444-555555555555";
    await upsertNoteInCache(username, { ...note, id: serverId }, false);
    await removeNoteFromCache(username, tempId);

    await upsertNoteBodyPreviewInCache(username, { ...note, id: tempId, body: ["Ghost"] });

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await notesNotesTable(db).get(tempId)).toBeUndefined();
    expect(await listPendingNoteIds(username)).not.toContain(tempId);
    const server = await notesNotesTable(db).get(serverId);
    expect(server?.pendingSync).toBe(false);
  });

  it("orders outbox mutations by createdAt", async () => {
    await enqueueOutboxMutation(username, {
      id: "b",
      domain: NOTES_DOMAIN,
      op: "delete",
      payload: "{}",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: NOTES_DOMAIN,
      op: "delete",
      payload: "{}",
    });
    const rows = await listOutboxMutations(username);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("records only the fields the enqueue actually changed", async () => {
    const local: Note = {
      ...note,
      id: "n-title",
      title: "Queued title",
      notebook: "Drafts",
      tags: ["essay", "focus"],
      starred: false,
      archived: false,
    };
    await upsertNoteInCache(username, local, true);
    await enqueueCoalescedNoteUpdate(username, local.id, local, local.date, undefined, undefined, {
      includeTitle: true,
    });
    await enqueueCoalescedNoteUpdate(username, local.id, local, local.date, undefined, undefined, {
      includeTags: true,
    });

    const fields = await listPendingNoteFields(username);
    expect([...(fields.get("n-title") ?? [])].sort()).toEqual(["tags", "title"]);

    const conflicts: string[][] = [];
    setNotesSyncConflictListener((ids) => {
      conflicts.push(ids);
    });
    try {
      await ingestRemoteNote(username, {
        ...local,
        archived: true,
      });
    } finally {
      setNotesSyncConflictListener(undefined);
    }

    expect(conflicts).toEqual([]);
    const cached = await getNoteFromCache(username, "n-title");
    expect(cached?.title).toBe("Queued title");
    expect(cached?.tags).toEqual(["essay", "focus"]);
    expect(cached?.archived).toBe(true);
  });

  it("does not restore a note while a delete is still queued", async () => {
    const local: Note = { ...note, id: "n-del", title: "Local title" };
    await upsertNoteInCache(username, local, true);
    await enqueueOutboxMutation(username, {
      id: "del-1",
      domain: NOTES_DOMAIN,
      op: "delete",
      payload: JSON.stringify({ noteId: local.id }),
    });

    await expect(ingestRemoteNote(username, { ...local, title: "From server" })).resolves.toBe(
      "skipped-pending",
    );

    const cached = await getNoteFromCache(username, local.id);
    expect(cached?.title).toBe("Local title");
  });

  it("removes a destroyed note when pendingSync is set but the outbox is empty", async () => {
    const local: Note = { ...note, id: "n-flag-only" };
    await upsertNoteInCache(username, local, true);

    await expect(ingestRemoteNoteDestroyed(username, local.id)).resolves.toBe("removed");
    expect(await getNoteFromCache(username, local.id)).toBeNull();
  });
});
