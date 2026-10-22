import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  listOutboxMutations,
  listPendingNoteIds,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable, notesNotebooksTable } from "@/lib/offline/notes/notes-schema";
import {
  createHybridNotesOperations,
  fetchNotesHybridBootstrap,
  getNotesSyncRunner,
} from "@/lib/offline/notes-hybrid-operations";
import { type NoteCreated, subscribeNoteCreated } from "@/lib/offline/notes/notes-created-events";
import { upgradeLegacyLocalNotes } from "@/lib/offline/notes/notes-legacy-local-ids";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes")>();
  return {
    ...actual,
    updateNoteItem: vi.fn(),
    createNoteItem: vi.fn(),
    archiveNoteItem: vi.fn(),
    fetchNotesLiveBootstrap: vi.fn(),
  };
});

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  getConnectivitySnapshot: vi.fn(() => true),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

import { archiveNoteItem, createNoteItem, fetchNotesLiveBootstrap } from "@/lib/api/wgw/notes";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

const username = "client-uid-user";
const uid = "4b1c2d3e-0000-4000-8000-000000000001";

const newNote: Note = {
  id: uid,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
  createPending: true,
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

function notesTable() {
  return notesNotesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
}

/** The server echoes the client UID back, as the API does. */
function serverEcho(): void {
  vi.mocked(createNoteItem).mockImplementation(async (body) => ({
    ...newNote,
    id: String(body.id),
    title: body.title ?? undefined,
    createPending: undefined,
  }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(readBrowserOnline).mockReturnValue(true);
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

async function flushed(): Promise<void> {
  await getNotesSyncRunner(username).flush();
}

describe("a note the app made", () => {
  it("is created online with its own UID and keeps that id", async () => {
    serverEcho();
    const heard: NoteCreated[] = [];
    const stop = subscribeNoteCreated((created) => heard.push(created));

    await createHybridNotesOperations(username).upsertNote(newNote);
    await flushed();
    stop();

    expect(createNoteItem).toHaveBeenCalledOnce();
    expect(vi.mocked(createNoteItem).mock.calls[0]?.[0].id).toBe(uid);
    const row = await notesTable().get(uid);
    expect(row?.pendingSync).toBe(false);
    expect(JSON.parse(row?.data ?? "{}").createPending).toBeUndefined();
    expect(heard).toEqual([{ username, noteId: uid }]);
  });

  it("waits in the outbox offline and is created with the same UID later", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await createHybridNotesOperations(username).upsertNote(newNote);
    expect(createNoteItem).not.toHaveBeenCalled();
    expect(await listPendingNoteIds(username)).toEqual([uid]);

    vi.mocked(readBrowserOnline).mockReturnValue(true);
    serverEcho();
    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue(bootstrap);
    await fetchNotesHybridBootstrap();

    expect(vi.mocked(createNoteItem).mock.calls.map((call) => call[0].id)).toEqual([uid]);
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });

  it("sends a title typed before the create in that same create", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const ops = createHybridNotesOperations(username);
    await ops.upsertNote(newNote);
    await ops.upsertNote({ ...newNote, title: "Typed early" });

    vi.mocked(readBrowserOnline).mockReturnValue(true);
    serverEcho();
    await flushed();

    expect(createNoteItem).toHaveBeenCalledOnce();
    expect(vi.mocked(createNoteItem).mock.calls[0]?.[0].title).toBe("Typed early");
  });

  it("is archived after its create instead of being dropped as gone", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const ops = createHybridNotesOperations(username);
    await ops.upsertNote(newNote);
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    let created = false;
    vi.mocked(createNoteItem).mockImplementation(async (body) => {
      created = true;
      return { ...newNote, id: String(body.id), createPending: undefined };
    });
    vi.mocked(archiveNoteItem).mockImplementation(async () => {
      expect(created).toBe(true);
      return { ...newNote, archived: true, createPending: undefined };
    });

    const archived = await ops.archiveNote(uid);
    await flushed();

    expect(archived.archived).toBe(true);
    expect(archiveNoteItem).toHaveBeenCalledOnce();
    expect(await notesTable().get(uid)).toBeDefined();
  });

  it("is sent to the server once when two tabs come back online", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await createHybridNotesOperations(username).upsertNote(newNote);
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(fetchNotesLiveBootstrap).mockResolvedValue(bootstrap);
    vi.mocked(createNoteItem).mockImplementation(async (body) => {
      // A real POST takes a while, so both tabs read the outbox before it returns.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ...newNote, id: String(body.id), createPending: undefined };
    });

    // Each tab runs its own load (flush) when it sees the connection again.
    await Promise.all([fetchNotesHybridBootstrap(), fetchNotesHybridBootstrap()]);

    expect(createNoteItem).toHaveBeenCalledOnce();
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });
});

describe("a bootstrap snapshot", () => {
  it("keeps a note cached after the snapshot was taken, and drops an older one it lacks", async () => {
    const takenAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await upsertNoteInCache(username, { ...newNote, createPending: undefined }, false);
    const older = { ...newNote, id: "4b1c2d3e-0000-4000-8000-000000000002" };
    await notesTable().put({
      id: older.id,
      notebookId: "Drafts",
      data: JSON.stringify(older),
      pendingSync: false,
      updatedAt: takenAt - 60_000,
    });

    await writeNotesBootstrapToCache(username, bootstrap, takenAt);

    expect(await notesTable().get(uid)).toBeDefined();
    expect(await notesTable().get(older.id)).toBeUndefined();
  });
});

describe("a note an older app queued with a temporary id", () => {
  it("is rewritten once to a UUID and queued as a create", async () => {
    const localId = "local-4b1c2d3e000040008000000000000009";
    await upsertNoteInCache(username, { ...newNote, id: localId, createPending: undefined }, true);
    await enqueueOutboxMutation(username, {
      id: "legacy-row",
      domain: "notes",
      op: "upsert",
      payload: JSON.stringify({
        noteId: localId,
        tempNoteId: localId,
        metadata: { notebook: "Drafts", tags: [] },
      }),
    });

    await upgradeLegacyLocalNotes(username);

    const upgraded = "4b1c2d3e-0000-4000-8000-000000000009";
    expect(await notesTable().get(localId)).toBeUndefined();
    expect(JSON.parse((await notesTable().get(upgraded))?.data ?? "{}").createPending).toBe(true);
    const [row] = await listOutboxMutations(username);
    expect(JSON.parse(row?.payload ?? "{}")).toMatchObject({ noteId: upgraded, create: true });
    expect(JSON.parse(row?.payload ?? "{}").tempNoteId).toBeUndefined();
  });
});
