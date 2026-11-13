import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import {
  enqueueOutboxMutation,
  listOutboxMutations,
  upsertNoteInCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { NOTES_DOMAIN, notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { flushNotesOutbox } from "@/lib/offline/notes-outbox-flush";

// #1854: Undo of an archive turns the queued row around while the flush may be sending it.

const username = "archive-undo";
const noteId = "aaaaaaaa-2222-3333-4444-555555555555";

const note: Note = {
  id: noteId,
  category: "Note",
  date: "2026-11-02T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
};

const { archiveNoteItem, restoreNoteItem } = vi.hoisted(() => ({
  archiveNoteItem: vi.fn(),
  restoreNoteItem: vi.fn(),
}));

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes")>();
  return { ...actual, archiveNoteItem, restoreNoteItem };
});

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
}));

describe("flushNotesOutbox with an archive undone mid-send", () => {
  beforeEach(async () => {
    archiveNoteItem.mockReset();
    restoreNoteItem.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await notesNotesTable(db).clear();
    await writeNotesBootstrapToCache(
      username,
      { session: mockWorkspaceSession, data: { notes: [note], notebooks: ["Drafts"], tags: [] } },
      Date.now(),
    );
    await upsertNoteInCache(username, note, true);
    await enqueueOutboxMutation(username, {
      id: "row-1",
      domain: NOTES_DOMAIN,
      op: "archive",
      payload: JSON.stringify({ noteId }),
    });
  });

  it("sends the restore too when Undo turned the row around while it was sent", async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    archiveNoteItem.mockImplementation(async () => {
      // Undo lands while the archive is on its way.
      const row = await db.outbox.get("row-1");
      await db.outbox.put({ ...row!, op: "restore" });
      return { ...note, archived: true };
    });
    restoreNoteItem.mockResolvedValue({ ...note, archived: false });

    await flushNotesOutbox(username);

    expect(archiveNoteItem).toHaveBeenCalledTimes(1);
    expect(restoreNoteItem).toHaveBeenCalledTimes(1);
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });

  it("sends only the restore when the row was turned around before the flush", async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await db.outbox.get("row-1");
    await db.outbox.put({ ...row!, op: "restore" });
    restoreNoteItem.mockResolvedValue({ ...note, archived: false });

    await flushNotesOutbox(username);

    expect(archiveNoteItem).not.toHaveBeenCalled();
    expect(restoreNoteItem).toHaveBeenCalledTimes(1);
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });
});
