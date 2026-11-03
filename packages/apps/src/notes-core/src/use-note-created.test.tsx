import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { announceNoteCreated } from "@/lib/offline/notes/notes-created-events";
import { markNoteCreated, useNoteCreated } from "./use-note-created";

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineNotesUsername: vi.fn(() => "created-user"),
}));

const note = (id: string, createPending?: boolean): Note => ({
  id,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
  ...(createPending ? { createPending } : {}),
});

describe("markNoteCreated", () => {
  it("clears the pending flag of that note only, keeping its id", () => {
    const rows = markNoteCreated([note("a", true), note("b", true)], "a");
    expect(rows.map((row) => [row.id, row.createPending])).toEqual([
      ["a", undefined],
      ["b", true],
    ]);
  });

  it("leaves the list alone when nothing is pending for that note", () => {
    const rows = [note("a")];
    expect(markNoteCreated(rows, "a")).toBe(rows);
  });
});

describe("useNoteCreated", () => {
  it("clears the flag when the create lands, for this account only", () => {
    let notes = [note("a", true)];
    const setNotes = vi.fn((next: Note[] | ((prev: Note[]) => Note[])) => {
      notes = typeof next === "function" ? next(notes) : next;
    });
    renderHook(() => useNoteCreated(setNotes));

    announceNoteCreated({ username: "someone-else", noteId: "a" });
    expect(notes[0]?.createPending).toBe(true);

    announceNoteCreated({ username: "created-user", noteId: "a" });
    expect(notes[0]?.createPending).toBeUndefined();
  });
});
