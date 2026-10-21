import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  getNoteFromCache,
  readNotesBootstrapFromCache,
  removeNotebookFromCache,
  upsertNoteInCache,
  upsertNotebookInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { notesNotesTable, notesNotebooksTable } from "@/lib/offline/notes/notes-schema";
import { createHybridNotesOperations } from "@/lib/offline/notes-hybrid-operations";
import { flushNotesOutbox } from "@/lib/offline/notes-outbox-flush";

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => false),
  getConnectivitySnapshot: vi.fn(() => false),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

const username = "notebook-cache-user";

const draft: Note = {
  id: "note-1",
  category: "Note",
  date: "2026-10-21T15:00:00.000Z",
  excerpt: "",
  body: ["Draft"],
  notebook: "Drafts",
  notebookId: "drafts",
  tags: [],
  wordCount: 1,
};

/** Written by another writer (inbound sync, another tab) mid-operation. */
const intruder: Note = { ...draft, id: "note-from-elsewhere", body: ["Elsewhere"] };

const bootstrap = {
  session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
  data: {
    notes: [draft],
    notebooks: ["Drafts", "Work"],
    notebookCollections: [
      { id: "drafts", name: "Drafts" },
      { id: "work", name: "Work" },
    ],
    tags: [],
  },
};

function db() {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

/**
 * Write `intruder` right after the operation's `nth` read of the notebook
 * list, which a cache snapshot reads after the notes table.
 */
function writeIntruderDuringRead(nth = 1) {
  const meta = db().meta;
  const realGet = meta.get.bind(meta);
  let reads = 0;
  vi.spyOn(meta, "get").mockImplementation((async (key: string) => {
    const value = await realGet(key);
    if (key === "notes:notebookCollections" && ++reads === nth) {
      await upsertNoteInCache(username, intruder, false);
    }
    return value;
  }) as typeof meta.get);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await db().outbox.clear();
  await notesNotesTable(db()).clear();
  await notesNotebooksTable(db()).clear();
  await db().meta.clear();
  await writeNotesBootstrapToCache(username, bootstrap);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a note written while a notebook change runs", () => {
  it("survives a notebook create", async () => {
    writeIntruderDuringRead();

    await upsertNotebookInCache(username, { id: "ideas", name: "Ideas" });

    expect(await getNoteFromCache(username, intruder.id)).not.toBeNull();
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toContain("Ideas");
  });

  it("survives a notebook rename", async () => {
    writeIntruderDuringRead();

    await createHybridNotesOperations(username).renameNotebook("Work", "Projects");

    expect(await getNoteFromCache(username, intruder.id)).not.toBeNull();
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).toContain("Projects");
    expect(cached?.data.notebooks).not.toContain("Work");
  });

  it("survives a notebook delete", async () => {
    writeIntruderDuringRead();

    await removeNotebookFromCache(username, "work", { keepPendingNotes: false });

    expect(await getNoteFromCache(username, intruder.id)).not.toBeNull();
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebooks).not.toContain("Work");
  });

  it("survives the end of an outbox flush", async () => {
    writeIntruderDuringRead(2);

    await flushNotesOutbox(username);

    expect(await getNoteFromCache(username, intruder.id)).not.toBeNull();
  });
});

describe("targeted notebook changes", () => {
  it("rename moves the notebook's notes and leaves others alone", async () => {
    await upsertNoteInCache(username, {
      ...draft,
      id: "work-note",
      notebook: "Work",
      notebookId: "work",
    });

    await upsertNotebookInCache(username, { id: "work", name: "Projects" });

    expect((await getNoteFromCache(username, "work-note"))?.notebook).toBe("Projects");
    expect((await getNoteFromCache(username, draft.id))?.notebook).toBe("Drafts");
  });

  it("delete drops the notebook's synced notes", async () => {
    await upsertNoteInCache(username, {
      ...draft,
      id: "work-note",
      notebook: "Work",
      notebookId: "work",
    });

    await removeNotebookFromCache(username, "work", { keepPendingNotes: false });

    expect(await getNoteFromCache(username, "work-note")).toBeNull();
    expect(await getNoteFromCache(username, draft.id)).not.toBeNull();
  });
});
