import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { announceNoteAdoption } from "@/lib/offline/notes/notes-adoption-events";
import { remapAdoptedNote, useNoteAdoptionRemap } from "./use-note-adoption-remap";

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineNotesUsername: vi.fn(() => "remap-user"),
}));

vi.mock("@/lib/offline/notes/notes-collab-persistence-migrate", () => ({
  migrateNoteCollabPersistenceAfterIdRemap: vi.fn(async () => undefined),
}));

const note = (id: string, title: string): Note => ({
  id,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
  title,
});

describe("remapAdoptedNote", () => {
  it("renames the temp row to the server id", () => {
    const rows = remapAdoptedNote(
      [note("local-a", "Typed"), note("n1", "Other")],
      "local-a",
      "srv",
    );
    expect(rows.map((row) => [row.id, row.title])).toEqual([
      ["srv", "Typed"],
      ["n1", "Other"],
    ]);
  });

  it("drops the temp row when the server note is already listed", () => {
    const rows = remapAdoptedNote(
      [note("local-a", "Typed"), note("srv", "Typed")],
      "local-a",
      "srv",
    );
    expect(rows.map((row) => row.id)).toEqual(["srv"]);
  });

  it("leaves the list alone when the temp row is not in it", () => {
    const rows = [note("n1", "Other")];
    expect(remapAdoptedNote(rows, "local-a", "srv")).toBe(rows);
  });
});

describe("useNoteAdoptionRemap", () => {
  it("moves the open note, selection and list row to the server id", () => {
    let notes = [note("local-a", "Typed")];
    let activeId = "local-a";
    let selected = ["local-a"];
    const setNotes = vi.fn((next: Note[] | ((prev: Note[]) => Note[])) => {
      notes = typeof next === "function" ? next(notes) : next;
    });
    const setActiveId = vi.fn((next: string | ((prev: string) => string)) => {
      activeId = typeof next === "function" ? next(activeId) : next;
    });
    const setSelectedIds = vi.fn((next: string[] | ((prev: string[]) => string[])) => {
      selected = typeof next === "function" ? next(selected) : next;
    });
    renderHook(() => useNoteAdoptionRemap({ setNotes, setActiveId, setSelectedIds }));

    announceNoteAdoption({ username: "remap-user", localId: "local-a", serverId: "srv" });

    expect(notes.map((row) => row.id)).toEqual(["srv"]);
    expect(activeId).toBe("srv");
    expect(selected).toEqual(["srv"]);
  });

  it("ignores an adoption for another account", () => {
    const setNotes = vi.fn();
    renderHook(() =>
      useNoteAdoptionRemap({ setNotes, setActiveId: vi.fn(), setSelectedIds: vi.fn() }),
    );

    announceNoteAdoption({ username: "someone-else", localId: "local-a", serverId: "srv" });

    expect(setNotes).not.toHaveBeenCalled();
  });
});
