import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import {
  enqueueCoalescedNoteUpdate,
  getNoteFromCache,
  listOutboxMutations,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { flushNotesOutbox } from "@/lib/offline/notes-outbox-flush";

// #1711: an edit queued while the flush is sending the same note's row.

const username = "inflight";
const noteId = "11111111-2222-3333-4444-555555555555";

const draft: Note = {
  id: noteId,
  category: "Note",
  date: "2026-10-28T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
};

const { updateNoteItem, createNoteItem } = vi.hoisted(() => ({
  updateNoteItem: vi.fn(),
  createNoteItem: vi.fn(),
}));

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes")>();
  return { ...actual, updateNoteItem, createNoteItem };
});

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** What `upsertNote` does offline: cache and queue in one transaction. */
async function queueEdit(note: Note, base: string | undefined): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.transaction("rw", [notesNotesTable(db), db.outbox], async () => {
    await upsertNoteInCache(username, note, true);
    await enqueueCoalescedNoteUpdate(username, note.id, note, base, note.createPending === true);
  });
}

describe("flushNotesOutbox with an edit queued mid-send (#1711)", () => {
  beforeEach(async () => {
    updateNoteItem.mockReset();
    createNoteItem.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await notesNotesTable(db).clear();
    await writeNotesBootstrapToCache(
      username,
      { session: mockWorkspaceSession, data: { notes: [], notebooks: ["Drafts"], tags: [] } },
      Date.now(),
    );
  });

  it("sends a title typed while the create is on its way", async () => {
    const pending = { ...draft, createPending: true };
    await queueEdit(pending, undefined);
    const createAnswer = deferred<Note>();
    createNoteItem.mockReturnValue(createAnswer.promise);
    updateNoteItem.mockImplementation(async (_id: string, request: { title?: string }) => ({
      ...draft,
      title: request.title,
      etag: '"e2"',
    }));

    const flushing = flushNotesOutbox(username);
    await vi.waitFor(() => expect(createNoteItem).toHaveBeenCalledOnce());
    await queueEdit({ ...pending, title: "Typed meanwhile" }, undefined);
    createAnswer.resolve({ ...draft, etag: '"e1"' });
    await flushing;

    expect(createNoteItem.mock.calls[0]?.[0]).not.toHaveProperty("title");
    expect(updateNoteItem).toHaveBeenCalledOnce();
    const [id, request] = updateNoteItem.mock.calls[0] ?? [];
    expect(id).toBe(noteId);
    expect(request).toMatchObject({ title: "Typed meanwhile", etag: '"e1"' });
    const cached = await getNoteFromCache(username, noteId);
    expect(cached?.title).toBe("Typed meanwhile");
    expect(cached?.createPending).toBeUndefined();
    expect(await listOutboxMutations(username)).toEqual([]);
  });

  it("keeps the newer title in the cache when the update is answered", async () => {
    const saved = { ...draft, title: "First", etag: '"e1"' };
    await upsertNoteInCache(username, saved, false);
    await queueEdit(saved, '"e1"');
    const firstAnswer = deferred<Note>();
    updateNoteItem.mockReturnValueOnce(firstAnswer.promise);
    updateNoteItem.mockResolvedValueOnce({ ...draft, title: "Second", etag: '"e3"' });

    const flushing = flushNotesOutbox(username);
    await vi.waitFor(() => expect(updateNoteItem).toHaveBeenCalledOnce());
    await queueEdit({ ...saved, title: "Second" }, '"e1"');
    firstAnswer.resolve({ ...draft, title: "First", etag: '"e2"' });
    await flushing;

    expect(updateNoteItem).toHaveBeenCalledTimes(2);
    expect(updateNoteItem.mock.calls[0]?.[1]).toMatchObject({ title: "First", etag: '"e1"' });
    // Rebased on the answer to the first send, so it is no stale-etag conflict.
    expect(updateNoteItem.mock.calls[1]?.[1]).toMatchObject({ title: "Second", etag: '"e2"' });
    expect((await getNoteFromCache(username, noteId))?.title).toBe("Second");
    expect(await listOutboxMutations(username)).toEqual([]);
  });

  it("keeps the newer title while the cache waits for the resend", async () => {
    const saved = { ...draft, title: "First", etag: '"e1"' };
    await upsertNoteInCache(username, saved, false);
    await queueEdit(saved, '"e1"');
    const firstAnswer = deferred<Note>();
    const secondAnswer = deferred<Note>();
    updateNoteItem.mockReturnValueOnce(firstAnswer.promise);
    updateNoteItem.mockReturnValueOnce(secondAnswer.promise);

    const flushing = flushNotesOutbox(username);
    await vi.waitFor(() => expect(updateNoteItem).toHaveBeenCalledOnce());
    await queueEdit({ ...saved, title: "Second" }, '"e1"');
    firstAnswer.resolve({ ...draft, title: "First", etag: '"e2"' });
    await vi.waitFor(() => expect(updateNoteItem).toHaveBeenCalledTimes(2));

    // The server's older answer must not overwrite the newer local title.
    const between = await getNoteFromCache(username, noteId);
    expect(between?.title).toBe("Second");
    secondAnswer.resolve({ ...draft, title: "Second", etag: '"e3"' });
    await flushing;
    expect((await getNoteFromCache(username, noteId))?.title).toBe("Second");
  });

  it("sends the queued title when a resent create is answered with the first version", async () => {
    // The tab closed after the POST landed; the row already holds the title.
    await queueEdit({ ...draft, createPending: true, title: "Before close" }, undefined);
    createNoteItem.mockResolvedValue({ ...draft, etag: '"e1"' });
    updateNoteItem.mockResolvedValue({ ...draft, title: "Before close", etag: '"e2"' });

    await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledOnce();
    const request = updateNoteItem.mock.calls[0]?.[1];
    expect(request).toMatchObject({ title: "Before close", etag: '"e1"' });
    // Not a move: the create already put the note in its notebook.
    expect(request).not.toHaveProperty("notebook");
    expect((await getNoteFromCache(username, noteId))?.title).toBe("Before close");
    expect(await listOutboxMutations(username)).toEqual([]);
  });

  it("sends a queued move when a resent create is answered in the first notebook", async () => {
    // Moved to Work while the first POST was on its way, then the tab closed.
    const moved = { ...draft, createPending: true, notebook: "Work", notebookId: "notes-work" };
    await queueEdit(moved, undefined);
    createNoteItem.mockResolvedValue({ ...draft, notebookId: "notes-drafts", etag: '"e1"' });
    updateNoteItem.mockResolvedValue({ ...moved, createPending: undefined, etag: '"e2"' });

    await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledOnce();
    expect(updateNoteItem.mock.calls[0]?.[1]).toMatchObject({
      notebook: "Work",
      notebookId: "notes-work",
      etag: '"e1"',
    });
    expect((await getNoteFromCache(username, noteId))?.notebookId).toBe("notes-work");
  });

  it("sends a queued unstar when a resent create is answered starred", async () => {
    await queueEdit({ ...draft, createPending: true, starred: false }, undefined);
    createNoteItem.mockResolvedValue({ ...draft, starred: true, etag: '"e1"' });
    updateNoteItem.mockResolvedValue({ ...draft, starred: false, etag: '"e2"' });

    await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledOnce();
    const request = updateNoteItem.mock.calls[0]?.[1];
    expect(request).toMatchObject({ starred: false });
    expect(request).not.toHaveProperty("notebook");
  });

  it("sends no follow-up when the create answer already matches", async () => {
    await queueEdit({ ...draft, createPending: true, title: "Same" }, undefined);
    createNoteItem.mockResolvedValue({ ...draft, title: "Same", etag: '"e1"' });

    await flushNotesOutbox(username);

    expect(updateNoteItem).not.toHaveBeenCalled();
    expect(await listOutboxMutations(username)).toEqual([]);
  });
});
