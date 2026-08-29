import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { NOTES_DOMAIN } from "@/lib/offline/notes/notes-schema";
import {
  enqueueCoalescedNoteUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readNotesBootstrapFromCache,
  upsertNoteInCache,
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
} satisfies ReturnType<typeof createNotesAppBootstrap>;

describe("notes offline store", () => {
  beforeEach(async () => {
    await writeNotesBootstrapToCache(username, bootstrap);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("reads bootstrap written to cache", async () => {
    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.body).toEqual(["Body text"]);
  });

  it("persists notebook color and does not drop sibling collections on upsert", async () => {
    const { upsertNotebookInCache } = await import("@/lib/offline/notes-offline-store");
    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notebooks: ["Drafts", "General"],
        notebookCollections: [
          { id: "notes-drafts", name: "Drafts", color: "#14b8a6" },
          { id: "notes-general", name: "General", color: "#0ea5e9" },
        ],
      },
    });

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
    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notebooks: ["General"],
        notebookCollections: [
          { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
        ],
        groups: [{ slug: "team", displayName: "Team" }],
      },
    });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notebookCollections).toEqual([
      { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
    ]);
    expect(cached?.data.groups).toEqual([{ slug: "team", displayName: "Team" }]);
  });

  it("preserves pendingSync notes when bootstrap is rewritten from server", async () => {
    const localNote = { ...note, body: ["Local body"] };
    await upsertNoteInCache(username, localNote, true);

    await writeNotesBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        notes: [{ ...note, body: ["Server body"] }],
      },
    });

    const cached = await readNotesBootstrapFromCache(username);
    expect(cached?.data.notes[0]?.body).toEqual(["Local body"]);
  });

  it("backfills empty pending body from server so list previews are not Untitled", async () => {
    const emptyLocal = { ...note, excerpt: "", body: [""], wordCount: 0, tags: ["pending"] };
    await upsertNoteInCache(username, emptyLocal, true);

    await writeNotesBootstrapToCache(username, {
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
    });

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
});
