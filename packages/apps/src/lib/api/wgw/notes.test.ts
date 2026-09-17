import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import {
  coerceNoteItem,
  coerceNotebookRow,
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
    expect(request).not.toHaveProperty("notebookId");
    expect(request).not.toHaveProperty("title");
  });

  it("includes SUMMARY when the note has a title", () => {
    const request = wgwNoteMetadataFromNote({ ...note, title: "Event" });
    expect(request.title).toBe("Event");
  });

  it("includes notebookId so a move can resolve dest by collection id", () => {
    const request = wgwNoteMetadataFromNote({
      ...note,
      notebookId: "notes-work",
      notebook: "Work",
    });
    expect(request.notebookId).toBe("notes-work");
    expect(request.notebook).toBe("Work");
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

  it("includes title on the create path so SUMMARY is not dropped", () => {
    expect(wgwNoteUpsertFromNote({ ...note, title: "Event" }).title).toBe("Event");
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

  it("maps hasShares from owned notes list items to isShared", () => {
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
});

describe("coerceNotebookRow", () => {
  it("maps hasShares from owned notebook list rows", () => {
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
});
