import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  enqueueCoalescedNoteUpdate,
  listOutboxMutations,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable, notesNotebooksTable } from "@/lib/offline/notes/notes-schema";
import { fetchNotesHybridBootstrap } from "@/lib/offline/notes-hybrid-operations";
import {
  type NoteAdoption,
  subscribeNoteAdoptions,
} from "@/lib/offline/notes/notes-adoption-events";

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

import { createNoteItem, fetchNotesLiveBootstrap } from "@/lib/api/wgw/notes";

const username = "cross-tab-user";
const tempId = "local-c7055000000000000000000000000001";

const queuedOffline: Note = {
  id: tempId,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  title: "Written offline",
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
};

const bootstrap = {
  session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
  data: { notes: [], notebooks: ["Drafts"], tags: [] },
};

/** Web Locks as the browser runs them: one holder per name, the rest wait in order. */
function installSerialWebLocks(): void {
  const tails = new Map<string, Promise<unknown>>();
  const locks = {
    request(name: string, _options: unknown, callback: () => Promise<unknown>) {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(() => callback());
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.outbox.clear();
  await notesNotesTable(db).clear();
  await notesNotebooksTable(db).clear();
  await db.meta.clear();
  await writeNotesBootstrapToCache(username, bootstrap, Date.now());
  installSerialWebLocks();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
});

describe("a create queued offline, adopted by the flush", () => {
  it("is announced so the open list and editor move to the server id", async () => {
    await upsertNoteInCache(username, queuedOffline, true);
    await enqueueCoalescedNoteUpdate(username, tempId, queuedOffline, undefined, tempId);
    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue(bootstrap);
    vi.mocked(createNoteItem).mockResolvedValue({ ...queuedOffline, id: "server-1" });
    const heard: NoteAdoption[] = [];
    const unsubscribe = subscribeNoteAdoptions((adoption) => heard.push(adoption));

    await fetchNotesHybridBootstrap();
    unsubscribe();

    expect(heard).toEqual([{ username, localId: tempId, serverId: "server-1" }]);
  });
});

describe("a create queued offline, with two tabs coming back online", () => {
  it("is sent to the server once", async () => {
    await upsertNoteInCache(username, queuedOffline, true);
    await enqueueCoalescedNoteUpdate(username, tempId, queuedOffline, undefined, tempId);
    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue(bootstrap);
    let created = 0;
    vi.mocked(createNoteItem).mockImplementation(async () => {
      created += 1;
      // A real POST takes a while, so both tabs read the outbox before it returns.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ...queuedOffline, id: `server-${created}` };
    });

    // Each tab runs its own load (heal + flush) when it sees the connection again.
    await Promise.all([fetchNotesHybridBootstrap(), fetchNotesHybridBootstrap()]);

    expect(createNoteItem).toHaveBeenCalledOnce();
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });
});
