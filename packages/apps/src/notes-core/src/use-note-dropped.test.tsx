import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { announceNoteDropped } from "@/lib/offline/notes/notes-dropped-events";
import { useNoteDropped } from "./use-note-dropped";

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineNotesUsername: vi.fn(() => "dropped-user"),
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

describe("useNoteDropped", () => {
  it("removes the note from the list and says so, for this account only", () => {
    let notes = [note("a"), note("b")];
    const setNotes = vi.fn((next: Note[] | ((prev: Note[]) => Note[])) => {
      notes = typeof next === "function" ? next(notes) : next;
    });
    const notify = vi.fn();
    renderHook(() => useNoteDropped(setNotes, notify));

    announceNoteDropped({ username: "someone-else", noteId: "a", title: "Other" });
    expect(notes).toHaveLength(2);

    announceNoteDropped({ username: "dropped-user", noteId: "a", title: "Shopping list" });
    expect(notes.map((row) => row.id)).toEqual(["b"]);
    expect(notify).toHaveBeenCalledWith("Shopping list");
  });
});
