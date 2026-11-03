import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import { noteFlagMap, sameNoteFlagMap, syncNoteFlagMap } from "@/notes-core/src/notes-flag-map";

const note = (id: string, flags: Partial<Pick<Note, "starred" | "archived">> = {}): Note => ({
  id,
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "Drafts",
  tags: [],
  wordCount: 0,
  ...flags,
});

describe("note flag maps", () => {
  it("maps flagged ids to true", () => {
    const notes = [note("a", { starred: true }), note("b"), note("c", { archived: true })];
    expect(noteFlagMap(notes, "starred")).toEqual({ a: true });
    expect(noteFlagMap(notes, "archived")).toEqual({ c: true });
  });

  it("treats a false entry as unset", () => {
    expect(sameNoteFlagMap({ a: true, b: false }, { a: true })).toBe(true);
    expect(sameNoteFlagMap({ a: true }, { a: true, b: true })).toBe(false);
    expect(sameNoteFlagMap({ a: true }, { b: true })).toBe(false);
  });

  it("keeps the previous map when the flagged ids did not change (#1714)", () => {
    const prev = { a: true };
    const notes = [note("a", { starred: true }), { ...note("b"), excerpt: "edited" }];
    expect(syncNoteFlagMap(notes, "starred")(prev)).toBe(prev);
    expect(syncNoteFlagMap([note("a")], "starred")(prev)).toEqual({});
  });
});
