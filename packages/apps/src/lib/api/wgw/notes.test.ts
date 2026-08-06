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
});
