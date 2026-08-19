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

  it("includes groupSlug for group-scoped create/update", () => {
    const groupNote: Note = {
      ...note,
      scope: "group",
      groupSlug: "eng",
      notebook: "Specs",
    };
    expect(wgwNoteUpsertFromNote(groupNote).groupSlug).toBe("eng");
    expect(wgwNoteMetadataFromNote(groupNote).groupSlug).toBe("eng");
    expect(wgwNoteUpsertFromNote(note)).not.toHaveProperty("groupSlug");
  });
});

describe("noteFromFileNodeNote", () => {
  it("maps FileNode note projection and Drive starred, never YAML", async () => {
    const { noteFromFileNodeNote } = await import("@/lib/api/wgw/notes-filenode");
    const mapped = noteFromFileNodeNote({
      id: "welcome",
      path: "/users/bob/.notes/Drafts/welcome.md",
      scope: "personal",
      modified: "2026-06-01T12:00:00.000Z",
      changed: "2024-01-01T00:00:00.000Z",
      projection: {
        title: "Welcome",
        tags: ["intro"],
        excerpt: "Hello from FileNode",
        notebook: "Drafts",
        archived: false,
        starred: true,
      },
    });
    expect(mapped.starred).toBe(true);
    expect(mapped.excerpt).toContain("Hello from FileNode");
    expect(mapped.date).toBe("2026-06-01T12:00:00.000Z");
    expect(mapped.updatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(mapped.apiPath).toBe("/users/bob/.notes/Drafts/welcome.md");
    expect(mapped.tags).toEqual(["intro"]);
  });

  it("treats missing Drive star as unstarred even when a YAML star used to exist", async () => {
    const { noteFromFileNodeNote } = await import("@/lib/api/wgw/notes-filenode");
    const mapped = noteFromFileNodeNote({
      id: "old",
      path: "/users/bob/.notes/Drafts/old.md",
      scope: "personal",
      projection: {
        title: "Old",
        tags: [],
        excerpt: "was yaml-starred",
        notebook: "Drafts",
        archived: false,
        starred: false,
      },
    });
    expect(mapped.starred).toBe(false);
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
  it("parses shared-with-me payloads and empty shared-notebooks", async () => {
    const { parseSharedNotesPayload, parseSharedNotebooksPayload, noteFromSharedEntry } =
      await import("@/lib/api/wgw/notes");

    const notes = parseSharedNotesPayload({
      items: [
        {
          path: "/users/bob/.notes/TeamPad/n1.md",
          id: "n1",
          notebook: "TeamPad",
          title: "Hello",
          tags: ["planning", "shared"],
          owner: "bob",
          scope: "personal",
          groupSlug: null,
          access: "view",
          myRights: { mayView: true },
        },
      ],
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.tags).toEqual(["planning", "shared"]);
    expect(noteFromSharedEntry(notes[0]!).sharedInbox).toBe(true);
    expect(noteFromSharedEntry(notes[0]!).apiPath).toBe("/users/bob/.notes/TeamPad/n1.md");
    expect(noteFromSharedEntry(notes[0]!).sharedBy).toBe("bob");
    expect(noteFromSharedEntry(notes[0]!).notebook).toBe("TeamPad");
    // Recipients never surface tags on Shared-with-me stubs.
    expect(noteFromSharedEntry(notes[0]!).tags).toEqual([]);
    expect(noteFromSharedEntry(notes[0]!).myRights).toEqual({ mayEditContent: false });
    expect(notes[0]?.myRights).toEqual({ mayEditContent: false });

    // Personal ACL notebook-dir shares removed — API returns empty ACL payload.
    expect(parseSharedNotebooksPayload({})).toEqual({ items: [], notes: [] });
    expect(parseSharedNotebooksPayload({ items: [], notes: [] })).toEqual({
      items: [],
      notes: [],
    });
  });

  it("maps hasShares from owned notes list items to isShared", async () => {
    const { noteFromWgwItem, coerceNoteItem } = await import("@/lib/api/wgw/notes");
    const row = coerceNoteItem({
      id: "n1",
      notebook: "Drafts",
      body: "hello",
      tags: [],
      archived: false,
      scope: "personal",
      groupSlug: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      hasShares: true,
      hasTeamShare: true,
    });
    expect(row?.hasShares).toBe(true);
    expect(noteFromWgwItem(row!).isShared).toBe(true);
    expect(
      noteFromWgwItem(
        coerceNoteItem({
          id: "n2",
          notebook: "Drafts",
          body: "private",
          tags: [],
          archived: false,
          scope: "personal",
          groupSlug: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        })!,
      ).isShared,
    ).toBeUndefined();
  });

  it("maps hasShares from owned notebook list rows", async () => {
    const { coerceNotebookRow } = await import("@/lib/api/wgw/notes");
    expect(
      coerceNotebookRow({
        name: "SharedPad",
        scope: "personal",
        activeCount: 1,
        archivedCount: 0,
        hasShares: true,
      })?.hasShares,
    ).toBe(true);
    expect(
      coerceNotebookRow({
        name: "Drafts",
        scope: "personal",
        activeCount: 2,
        archivedCount: 0,
      })?.hasShares,
    ).toBeUndefined();
  });

  it("maps shared-with-me body preview into list title without using local-* id", async () => {
    const { noteFromSharedEntry, sharedEntryListPreview } = await import("@/lib/api/wgw/notes");
    const { noteListTitle } = await import("@/notes-core/src/notes-note-utils");
    const localId = "local-55a6723bcd6e453aa11abf548f043398";

    const withBody = noteFromSharedEntry({
      path: `/users/wouter/.notes/Cooking/${localId}.md`,
      id: localId,
      notebook: "Cooking",
      title: "Pasta with garlic and oil",
      tags: [],
      owner: "wouter",
      scope: "personal",
      groupSlug: null,
    });
    expect(noteListTitle(withBody)).toBe("Pasta with garlic and oil");
    expect(noteListTitle(withBody)).not.toMatch(/^local-/);

    // API may still echo the id when body is empty — never show it as the list title.
    expect(sharedEntryListPreview({ id: localId, title: localId })).toBe("");
    expect(sharedEntryListPreview({ id: localId, title: "" })).toBe("");
    const emptyBody = noteFromSharedEntry({
      path: `/users/wouter/.notes/Cooking/${localId}.md`,
      id: localId,
      notebook: "Cooking",
      title: localId,
      tags: [],
      owner: "wouter",
      scope: "personal",
      groupSlug: null,
    });
    expect(emptyBody.excerpt).toBe("");
    expect(emptyBody.body).toEqual([""]);
    expect(noteListTitle(emptyBody)).toBe("Untitled note");
    expect(noteListTitle(emptyBody)).not.toBe(localId);
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
        tags: [],
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
        tags: [],
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
        tags: [],
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
