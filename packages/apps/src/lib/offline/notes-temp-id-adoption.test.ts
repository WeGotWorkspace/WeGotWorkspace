import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  listOutboxMutations,
  listPendingNoteIds,
  readNotesBootstrapFromCache,
  upsertNoteBodyPreviewInCache,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable, notesNotebooksTable } from "@/lib/offline/notes/notes-schema";
import {
  createHybridNotesOperations,
  fetchNotesHybridBootstrap,
} from "@/lib/offline/notes-hybrid-operations";

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes")>();
  return {
    ...actual,
    updateNoteItem: vi.fn(),
    createNoteItem: vi.fn(),
    fetchNotesLiveBootstrap: vi.fn(),
  };
});

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  getConnectivitySnapshot: vi.fn(() => true),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

import { createNoteItem, fetchNotesLiveBootstrap, updateNoteItem } from "@/lib/api/wgw/notes";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

const username = "adoption-user";
const tempId = "local-8b8f0000000000000000000000000001";
const serverId = "ad0f28e6-0000-4000-8000-000000000001";

const existing: Note = {
  id: "note-1",
  category: "Note",
  date: "2026-10-21T15:00:00.000Z",
  excerpt: "",
  body: ["Existing"],
  notebook: "Drafts",
  tags: [],
  wordCount: 1,
};

const localNote: Note = {
  ...existing,
  id: tempId,
  date: "2026-10-21T15:22:21.000Z",
  body: [""],
  wordCount: 0,
};

const serverNote: Note = { ...localNote, id: serverId, etag: '"etag-1"' };

const bootstrap = {
  session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
  data: { notes: [existing], notebooks: ["Drafts"], tags: [] },
};

function notesTable() {
  return notesNotesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
}

async function createOnline(): Promise<Note> {
  await upsertNoteInCache(username, localNote, true);
  vi.mocked(createNoteItem).mockResolvedValue(serverNote);
  return createHybridNotesOperations(username).upsertNote(localNote);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(readBrowserOnline).mockReturnValue(true);
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

describe("local-* row after an online create", () => {
  it("is not written back by a bootstrap snapshot read before the create", async () => {
    await upsertNoteInCache(username, localNote, true);
    const stale = await readNotesBootstrapFromCache(username);

    await createOnline();
    await writeNotesBootstrapToCache(username, stale!);

    expect(await notesTable().get(tempId)).toBeUndefined();
  });

  it("is not re-inserted by a late optimistic write", async () => {
    await createOnline();

    await upsertNoteInCache(username, { ...localNote, title: "Ha" }, true);

    expect(await notesTable().get(tempId)).toBeUndefined();
    expect(await listPendingNoteIds(username)).toEqual([]);
  });

  it("is not refreshed by a late title preview when a stale row survived", async () => {
    await createOnline();
    await notesTable().put({
      id: tempId,
      notebookId: "Drafts",
      data: JSON.stringify(localNote),
      pendingSync: true,
      updatedAt: Date.now(),
    });

    await upsertNoteBodyPreviewInCache(username, { ...localNote, title: "Ha" });
    await writeNotesBootstrapToCache(username, (await readNotesBootstrapFromCache(username))!);

    expect(await notesTable().get(tempId)).toBeUndefined();
  });

  it("is dropped by a bootstrap write when it is pending but already adopted", async () => {
    await createOnline();
    await notesTable().put({
      id: tempId,
      notebookId: "Drafts",
      data: JSON.stringify({ ...localNote, title: "Ha" }),
      pendingSync: true,
      updatedAt: Date.now(),
    });

    await writeNotesBootstrapToCache(username, bootstrap);

    expect(await listPendingNoteIds(username)).toEqual([]);
  });
});

describe("writeNotesBootstrapToCache", () => {
  it("keeps a pending row written while the bootstrap write runs", async () => {
    const pending = { ...existing, id: "note-2", title: "Written meanwhile" };

    await Promise.all([
      writeNotesBootstrapToCache(username, bootstrap),
      upsertNoteInCache(username, pending, true),
    ]);

    const row = await notesTable().get("note-2");
    expect(row?.pendingSync).toBe(true);
  });
});

describe("healing a pending local-* row without an outbox", () => {
  it("folds an adopted row onto the server note instead of creating a second note", async () => {
    await createOnline();
    await notesTable().put({
      id: tempId,
      notebookId: "Drafts",
      data: JSON.stringify({ ...localNote, title: "Ha" }),
      pendingSync: true,
      updatedAt: Date.now(),
    });
    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue({
      ...bootstrap,
      data: { ...bootstrap.data, notes: [existing, serverNote] },
    });
    vi.mocked(updateNoteItem).mockResolvedValue({ ...serverNote, title: "Ha" });

    const result = await fetchNotesHybridBootstrap();

    expect(createNoteItem).toHaveBeenCalledOnce();
    expect(updateNoteItem).toHaveBeenCalledOnce();
    expect(vi.mocked(updateNoteItem).mock.calls[0]?.[0]).toBe(serverId);
    expect(vi.mocked(updateNoteItem).mock.calls[0]?.[1]).toMatchObject({ title: "Ha" });
    expect(await notesTable().get(tempId)).toBeUndefined();
    expect(await listPendingNoteIds(username)).toEqual([]);
    expect(await listOutboxMutations(username)).toHaveLength(0);
    expect(result.data.notes.filter((row) => row.id === tempId)).toEqual([]);
    expect(result.data.notes.find((row) => row.id === serverId)?.title).toBe("Ha");
  });
});

describe("title on an offline create", () => {
  it("rides on the queued create when typed before the note syncs", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridNotesOperations(username);
    await operations.upsertNote(localNote);

    await operations.upsertNote({ ...localNote, title: "Ha" });

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    const payload = JSON.parse(outbox[0]?.payload ?? "{}");
    expect(payload.tempNoteId).toBe(tempId);
    expect(payload.metadata.title).toBe("Ha");
  });
});
