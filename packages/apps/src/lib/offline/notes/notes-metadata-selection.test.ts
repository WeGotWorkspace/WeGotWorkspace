import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import { metadataSelection } from "./notes-metadata-selection";

const note: Note = {
  id: "4b1c2d3e-0000-4000-8000-000000000001",
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "General",
  notebookId: "notes-general",
  tags: [],
  wordCount: 0,
};
const movedCopy: Note = { ...note, notebook: "Work", notebookId: "notes-work" };

describe("metadataSelection", () => {
  it("never moves the note from a save that does not name the notebook", () => {
    // The cached copy already holds a move this (older) save never saw.
    expect(metadataSelection(movedCopy, note, false).includeNotebook).toBe(false);
    expect(metadataSelection(movedCopy, note, false, ["title"]).includeNotebook).toBe(false);
  });

  it("sends the notebook when the save names it: that is the move", () => {
    expect(metadataSelection(note, movedCopy, false, ["notebook"]).includeNotebook).toBe(true);
  });
});
