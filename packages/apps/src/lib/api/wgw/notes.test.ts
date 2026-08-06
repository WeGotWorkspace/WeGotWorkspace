import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import {
  coerceNoteItem,
  noteFromWgwItem,
  wgwNoteMetadataFromNote,
  wgwNoteUpsertFromNote,
} from "@/lib/api/wgw/notes";

const note: Note = {
  id: "note-1",
  category: "Note",
  date: "2024-10-12T10:00:00.000Z",
  excerpt: "Draft excerpt",
  body: ["Body text", "Second paragraph"],
  notebook: "Drafts",
  tags: ["essay"],
  wordCount: 4,
};

describe("wgwNoteMetadataFromNote", () => {
  it("omits the body key entirely so a metadata PUT never clears the body", () => {
    const request = wgwNoteMetadataFromNote(note, { starred: true, archived: false });

    // The key must be ABSENT (not body: "" / null) because Laravel's
    // ConvertEmptyStringsToNull treats a present empty/null body as "clear body".
    expect(request).not.toHaveProperty("body");
    expect(Object.keys(request)).not.toContain("body");
    expect(JSON.stringify(request)).not.toContain('"body"');

    expect(request).toMatchObject({
      id: "note-1",
      notebook: "Drafts",
      tags: ["essay"],
      starred: true,
      archived: false,
    });
    expect(request).not.toHaveProperty("title");
  });

  it("omits starred/archived when not provided", () => {
    const request = wgwNoteMetadataFromNote(note);

    expect(request).not.toHaveProperty("body");
    expect(request).not.toHaveProperty("starred");
    expect(request).not.toHaveProperty("archived");
  });
});

describe("wgwNoteUpsertFromNote", () => {
  it("includes the joined body for the create (POST) path", () => {
    const request = wgwNoteUpsertFromNote(note);

    expect(request.body).toBe("Body text\n\nSecond paragraph");
  });
});

describe("noteFromWgwItem", () => {
  it("prefers contentUpdatedAt for display date and keeps metadata updatedAt", () => {
    const row = coerceNoteItem({
      id: "n-1",
      notebook: "Drafts",
      body: "Hello from collab",
      tags: [],
      updatedAt: "2024-01-01T00:00:00.000Z",
      contentUpdatedAt: "2026-06-01T12:00:00.000Z",
    });
    expect(row).not.toBeNull();
    const mapped = noteFromWgwItem(row!);
    expect(mapped.date).toBe("2026-06-01T12:00:00.000Z");
    expect(mapped.updatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(mapped.excerpt).toContain("Hello from collab");
  });

  it("derives excerpt from body so empty-title historical notes are not Untitled", () => {
    const row = coerceNoteItem({
      id: "n1781784184",
      notebook: "Drafts",
      body: "Donec ullamcorper nulla non metus auctor fringilla.",
      tags: [],
      updatedAt: "2026-06-18T12:02:37+00:00",
    });
    expect(row).not.toBeNull();
    const mapped = noteFromWgwItem(row!);
    expect(mapped.excerpt).toMatch(/Donec ullamcorper/);
    expect(mapped.body[0]).toContain("Donec ullamcorper");
  });

  it("preserves group scope and groupSlug on mapped notes", () => {
    const row = coerceNoteItem({
      id: "n-g",
      notebook: "Specs",
      body: "Hello",
      scope: "group",
      groupSlug: "eng",
    });
    expect(row).not.toBeNull();
    const mapped = noteFromWgwItem(row!);
    expect(mapped.scope).toBe("group");
    expect(mapped.groupSlug).toBe("eng");
  });
});

describe("shared notes listing parsers", () => {
  it("parses shared-with-me and shared-notebooks payloads", async () => {
    const { parseSharedNotesPayload, parseSharedNotebooksPayload, noteFromSharedEntry } =
      await import("@/lib/api/wgw/notes");

    const notes = parseSharedNotesPayload({
      items: [
        {
          path: "/users/bob/.notes/TeamPad/n1.md",
          id: "n1",
          notebook: "TeamPad",
          title: "Hello",
          owner: "bob",
          scope: "personal",
          groupSlug: null,
          access: "view",
          myRights: { mayView: true },
        },
      ],
    });
    expect(notes).toHaveLength(1);
    expect(noteFromSharedEntry(notes[0]!).sharedInbox).toBe(true);
    expect(noteFromSharedEntry(notes[0]!).apiPath).toBe("/users/bob/.notes/TeamPad/n1.md");

    const notebooks = parseSharedNotebooksPayload({
      items: [
        {
          path: "/users/bob/.notes/TeamPad",
          notebook: "TeamPad",
          owner: "bob",
          scope: "personal",
          groupSlug: null,
          access: "edit",
          myRights: { mayEditContent: true },
        },
      ],
    });
    expect(notebooks[0]?.path).toBe("/users/bob/.notes/TeamPad");
  });

  it("keeps shared inbox notes when owned ids collide (local-* leak / duplicate grants)", async () => {
    const { mergeOwnedAndSharedInboxNotes, sharedInboxFallbackId } =
      await import("@/lib/api/wgw/notes");
    const { filterVisibleNotes } = await import("@/notes-core/src/notes-note-utils");

    const sharedId = "local-0ee49942b3c448658dc9a8f79202220a";
    const sharedPath = `/users/admin/.notes/Drafts/${sharedId}.md`;
    const serverNotePath = "/users/admin/.notes/Drafts/n1781784157.md";
    const owned = [
      {
        id: sharedId,
        notebook: "Drafts",
        excerpt: "mine",
        body: ["mine"],
        tags: [],
        wordCount: 1,
        category: "Note",
        date: "—",
        archived: true,
      },
    ];
    const sharedWithMe = [
      {
        path: sharedPath,
        id: sharedId,
        notebook: "Drafts",
        title: "Shared local",
        owner: "admin",
        scope: "personal" as const,
        groupSlug: null,
        access: "edit",
      },
      {
        path: `/users/admin/.notes/Test/${sharedId}.md`,
        id: sharedId,
        notebook: "Test",
        title: "Shared local test",
        owner: "admin",
        scope: "personal" as const,
        groupSlug: null,
        access: "edit",
      },
      {
        path: serverNotePath,
        id: "n1781784157",
        notebook: "Drafts",
        title: "E2E seed",
        owner: "admin",
        scope: "personal" as const,
        groupSlug: null,
        access: "edit",
      },
    ];

    const merged = mergeOwnedAndSharedInboxNotes(owned, sharedWithMe);
    const inbox = filterVisibleNotes(merged, {
      view: "shared-with-me",
      archived: { [sharedId]: true },
      starred: {},
      searchQuery: "",
    });

    expect(inbox.map((n) => n.apiPath).sort()).toEqual(
      [sharedPath, `/users/admin/.notes/Test/${sharedId}.md`, serverNotePath].sort(),
    );
    expect(inbox.every((n) => n.sharedInbox)).toBe(true);
    expect(inbox.find((n) => n.apiPath === sharedPath)?.id).toBe(sharedInboxFallbackId(sharedPath));
    expect(inbox.find((n) => n.id === "n1781784157")?.apiPath).toBe(serverNotePath);
  });
});
