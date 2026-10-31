import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  getNoteFromCache,
  listOutboxMutations,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { createHybridNotesOperations } from "@/lib/offline/notes-hybrid-operations";

// #1711: an online edit made while the flush still sends this note's queued
// save is merged into that save, not sent beside it.

const username = "inflight-online";
const noteId = "22222222-3333-4444-5555-666666666666";

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
  getConnectivitySnapshot: vi.fn(() => true),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("upsertNote while the note's queued save is on its way (#1711)", () => {
  beforeEach(async () => {
    updateNoteItem.mockReset();
    createNoteItem.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await notesNotesTable(db).clear();
    await writeNotesBootstrapToCache(
      username,
      {
        session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
        data: { notes: [], notebooks: ["Drafts"], tags: [] },
      },
      Date.now(),
    );
  });

  it("keeps a tag queued during the create when an older title save arrives", async () => {
    const ops = createHybridNotesOperations(username);
    const createAnswer = deferred<Note>();
    createNoteItem.mockReturnValue(createAnswer.promise);
    updateNoteItem.mockImplementation(async (_id: string, request: { title?: string }) => ({
      ...draft,
      title: request.title,
      tags: ["urgent"],
      etag: '"e2"',
    }));

    await ops.upsertNote({ ...draft, createPending: true });
    await vi.waitFor(() => expect(createNoteItem).toHaveBeenCalledOnce());
    await ops.upsertNote({ ...draft, createPending: true, tags: ["urgent"] }, { fields: ["tags"] });
    // The debounced title save holds the snapshot from the last keystroke.
    await ops.upsertNote({ ...draft, createPending: true, title: "T" }, { fields: ["title"] });

    const [row] = await listOutboxMutations(username);
    expect(JSON.parse(row?.payload ?? "{}").metadata).toMatchObject({
      title: "T",
      tags: ["urgent"],
    });
    const cached = await getNoteFromCache(username, noteId);
    expect(cached).toMatchObject({ title: "T", tags: ["urgent"] });
    createAnswer.resolve({ ...draft, etag: '"e1"' });
    await vi.waitFor(async () => expect(await listOutboxMutations(username)).toEqual([]));
  });

  it("merges a title typed during the follow-up save into it", async () => {
    const ops = createHybridNotesOperations(username);
    const createAnswer = deferred<Note>();
    const resendAnswer = deferred<Note>();
    createNoteItem.mockReturnValue(createAnswer.promise);
    updateNoteItem.mockReturnValueOnce(resendAnswer.promise);
    updateNoteItem.mockImplementation(async (_id: string, request: { title?: string }) => ({
      ...draft,
      title: request.title,
      etag: '"e3"',
    }));

    await ops.upsertNote({ ...draft, createPending: true });
    await vi.waitFor(() => expect(createNoteItem).toHaveBeenCalledOnce());
    await ops.upsertNote({ ...draft, createPending: true, title: "A" }, { fields: ["title"] });
    createAnswer.resolve({ ...draft, etag: '"e1"' });
    // The flush sends title A as an update on the create's answer.
    await vi.waitFor(() => expect(updateNoteItem).toHaveBeenCalledOnce());
    expect(updateNoteItem.mock.calls[0]?.[1]).toMatchObject({ title: "A", etag: '"e1"' });

    // The cache no longer marks it as a create, but its save is still queued.
    await ops.upsertNote({ ...draft, title: "B" }, { fields: ["title"] });
    expect(updateNoteItem, "no second save beside the flush's").toHaveBeenCalledOnce();

    resendAnswer.resolve({ ...draft, title: "A", etag: '"e2"' });
    await vi.waitFor(async () => expect(await listOutboxMutations(username)).toEqual([]));
    expect(updateNoteItem).toHaveBeenCalledTimes(2);
    expect(updateNoteItem.mock.calls[1]?.[1]).toMatchObject({ title: "B", etag: '"e2"' });
    expect((await getNoteFromCache(username, noteId))?.title).toBe("B");
  });
});
