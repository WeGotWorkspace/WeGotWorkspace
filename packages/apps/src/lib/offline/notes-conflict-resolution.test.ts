import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import {
  enqueueCoalescedNoteUpdate,
  listOutboxMutations,
  readNotesBootstrapFromCache,
  writeNotesBootstrapToCache,
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
};

const { flushNotesOutbox, fetchServerNote } = vi.hoisted(() => ({
  flushNotesOutbox: vi.fn(),
  fetchServerNote: vi.fn(),
}));

vi.mock("@/lib/offline/notes-outbox-flush", () => ({
  flushNotesOutbox,
  fetchServerNote,
}));

import {
  resolveNotesConflictKeepLocal,
  resolveNotesConflictUseServer,
} from "@/lib/offline/notes-conflict-resolution";

describe("notes conflict resolution", () => {
  beforeEach(async () => {
    flushNotesOutbox.mockReset();
    fetchServerNote.mockReset();
    flushNotesOutbox.mockResolvedValue({ stateMismatches: [], bootstrap });
    await writeNotesBootstrapToCache(username, bootstrap);
    await enqueueCoalescedNoteUpdate(username, note.id, note, note.date);
  });

  it("keep local PATCHes with the fresh server etag and re-flushes", async () => {
    fetchServerNote.mockResolvedValue({ ...note, etag: '"etag-fresh"' });

    await resolveNotesConflictKeepLocal(username, note.id);

    const rows = await listOutboxMutations(username);
    expect(rows[0]?.ifInState).toBe('"etag-fresh"');
    expect(rows[0]?.lastError).toBeUndefined();
    expect(flushNotesOutbox).toHaveBeenCalledOnce();
  });

  it("use server drops queued rows and refreshes from server", async () => {
    fetchServerNote.mockResolvedValue({ ...note, body: ["Server body"] });

    await resolveNotesConflictUseServer(username, note.id);

    expect(await listOutboxMutations(username)).toHaveLength(0);
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.body).toEqual(["Server body"]);
  });
});
