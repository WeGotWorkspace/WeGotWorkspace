import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import { noteListTitle } from "@/notes-core/src/notes-note-utils";
import { mapNotesWithTitle } from "@/notes-core/src/note-title-projection";

const note: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "Hello excerpt",
  body: ["# Other", "Notes"],
  notebook: "Drafts",
  tags: [],
  wordCount: 2,
  title: "Event",
};

describe("note title list projection", () => {
  it("keeps the list title when the doc title has not changed", () => {
    const notes = [note];
    const same = mapNotesWithTitle(notes, note.id, "Event");
    expect(same.notes).toBe(notes);
    expect(noteListTitle(same.notes[0]!)).toBe("Event");
  });

  it("shows the doc title on the list row", () => {
    const next = mapNotesWithTitle([note], note.id, "Renamed");
    expect(next.updated?.title).toBe("Renamed");
    expect(noteListTitle(next.notes[0]!)).toBe("Renamed");
  });
});
