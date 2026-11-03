import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { announceNoteArchivedElsewhere } from "@/lib/offline/notes/notes-archived-elsewhere";
import { useNoteArchivedElsewhere } from "./use-note-archived-elsewhere";

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineNotesUsername: vi.fn(() => "archived-user"),
}));

const note = (id: string): Note => ({
  id,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "General",
  tags: [],
  wordCount: 0,
});

describe("useNoteArchivedElsewhere (#1535)", () => {
  it("marks the note archived and says so, for this account only", () => {
    let notes = [note("a"), note("b")];
    const setNotes = vi.fn((next: Note[] | ((prev: Note[]) => Note[])) => {
      notes = typeof next === "function" ? next(notes) : next;
    });
    const notify = vi.fn();
    renderHook(() => useNoteArchivedElsewhere(setNotes, notify));

    announceNoteArchivedElsewhere({ username: "someone-else", noteId: "a", title: "Other" });
    expect(notes.some((row) => row.archived)).toBe(false);
    expect(notify).not.toHaveBeenCalled();

    announceNoteArchivedElsewhere({
      username: "archived-user",
      noteId: "a",
      title: "Shopping list",
    });
    expect(notes.map((row) => [row.id, !!row.archived])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(notify).toHaveBeenCalledWith("Shopping list");
  });
});
