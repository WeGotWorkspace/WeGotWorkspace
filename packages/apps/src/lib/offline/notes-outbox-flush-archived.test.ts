import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { NotesVjournalRequestError } from "@/lib/api/wgw/notes-vjournal";
import type { Note } from "@/lib/models/note";
import {
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  getNoteFromCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { flushNotesOutbox } from "@/lib/offline/notes-outbox-flush";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import {
  isNoteArchivedRefusal,
  subscribeNoteArchivedElsewhere,
} from "@/lib/offline/notes/notes-archived-elsewhere";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { CollabHttpError } from "@/text-editor-core/docs-collab/docs-collab-utils";

const username = "archived-elsewhere-user";

const note: Note = {
  id: "note-1",
  title: "Shopping list",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "",
  body: ["Body text"],
  notebook: "Drafts",
  tags: ["essay"],
  wordCount: 2,
};

const { updateNoteItem, deleteNoteItem } = vi.hoisted(() => ({
  updateNoteItem: vi.fn(),
  deleteNoteItem: vi.fn(),
}));

vi.mock("@/lib/api/wgw/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/notes")>()),
  updateNoteItem,
  deleteNoteItem,
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
}));

const archivedRefusal = () => new NotesVjournalRequestError("note_archived", 409, "note_archived");

describe("a queued edit to a note archived elsewhere (#1535)", () => {
  let notices: string[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(async () => {
    updateNoteItem.mockReset();
    deleteNoteItem.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await writeNotesBootstrapToCache(
      username,
      { session: mockWorkspaceSession, data: { notes: [note], notebooks: ["Drafts"], tags: [] } },
      Date.now(),
    );
    notices = [];
    unsubscribe = subscribeNoteArchivedElsewhere((event) => {
      if (event.username === username) notices.push(event.title);
    });
  });

  afterEach(() => unsubscribe());

  it("ends with a notice: archive wins, the edit is not retried and not a conflict", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, { ...note, title: "Edited offline" }, "");
    updateNoteItem.mockRejectedValue(archivedRefusal());

    const result = await flushNotesOutbox(username);

    expect(result.stateMismatches).toEqual([]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    expect(await db.outbox.toArray()).toHaveLength(0);
    const cached = await getNoteFromCache(username, note.id);
    expect(cached?.archived).toBe(true);
    expect(notices).toEqual(["Shopping list"]);

    await flushNotesOutbox(username);
    expect(updateNoteItem).toHaveBeenCalledOnce();
  });

  it("tells once when two queued rows for the note are refused", async () => {
    for (const [id, metadata] of [
      ["upsert-tag", { notebook: "Drafts", tagsAdd: ["focus"] }],
      ["upsert-title", { notebook: "Drafts", title: "Edited offline" }],
    ] as const) {
      await enqueueOutboxMutation(username, {
        id,
        domain: NOTES_DOMAIN,
        op: "upsert",
        payload: JSON.stringify({ noteId: note.id, metadata }),
      });
    }
    updateNoteItem.mockRejectedValue(archivedRefusal());

    await flushNotesOutbox(username);

    expect(updateNoteItem).toHaveBeenCalledOnce();
    expect(notices).toHaveLength(1);
  });

  it("still runs a queued delete for that note", async () => {
    await enqueueCoalescedNoteUpdate(username, note.id, { ...note, title: "Edited offline" }, "");
    await enqueueOutboxMutation(username, {
      id: "delete-after-edit",
      domain: NOTES_DOMAIN,
      op: "delete",
      payload: JSON.stringify({ noteId: note.id, notebook: "Drafts", archived: true }),
    });
    updateNoteItem.mockRejectedValue(archivedRefusal());
    deleteNoteItem.mockResolvedValue(undefined);

    await flushNotesOutbox(username);

    expect(deleteNoteItem).toHaveBeenCalledOnce();
    expect(await getNoteFromCache(username, note.id)).toBeNull();
  });
});

describe("isNoteArchivedRefusal", () => {
  it("reads the REST code and the collab error text", () => {
    expect(isNoteArchivedRefusal(archivedRefusal())).toBe(true);
    expect(isNoteArchivedRefusal(new CollabHttpError("note_archived", 409))).toBe(true);
    expect(isNoteArchivedRefusal(new CollabHttpError("external_write", 409))).toBe(false);
    expect(
      isNoteArchivedRefusal(new NotesVjournalRequestError("Conflict", 409, "alreadyExists")),
    ).toBe(false);
  });
});
