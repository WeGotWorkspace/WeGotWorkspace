import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import { noteTagsAfterRename, planNoteTagRename } from "@/notes-core/src/note-tag-rename";

function note(partial: Partial<Note> & Pick<Note, "id" | "tags">): Note {
  return {
    category: "Note",
    date: "2026-01-01T00:00:00.000Z",
    excerpt: "",
    body: [""],
    notebook: "Drafts",
    wordCount: 0,
    ...partial,
  };
}

describe("planNoteTagRename", () => {
  it("returns invalid-name for a tag outside a-z and hyphen", () => {
    expect(planNoteTagRename([note({ id: "n", tags: ["focus"] })], "focus", "Foo Bar")).toBe(
      "invalid-name",
    );
  });

  it("returns unchanged when the new name is the same tag in another case", () => {
    expect(planNoteTagRename([note({ id: "n", tags: ["Focus"] })], "Focus", "focus")).toBe(
      "unchanged",
    );
  });

  it("returns nothing-to-rename when no note carries the tag", () => {
    expect(planNoteTagRename([note({ id: "n", tags: ["other"] })], "focus", "reading")).toBe(
      "nothing-to-rename",
    );
  });

  it("skips archived and read-only notes and counts them (#1535)", () => {
    const archived = note({ id: "arch", tags: ["focus"], archived: true });
    const writable = note({ id: "own", tags: ["Focus"] });
    const readOnly = note({ id: "ro", tags: ["focus"], sharedInbox: true, sharedBy: "bob" });
    const plan = planNoteTagRename([archived, writable, readOnly], "focus", "reading");
    expect(plan).toMatchObject({
      from: "focus",
      to: "reading",
      skippedCount: 2,
      mergedIds: [],
    });
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.notes.map((row) => row.id)).toEqual(["own"]);
  });

  it("lists notes that already carried the target tag", () => {
    const merged = note({ id: "both", tags: ["focus", "reading"] });
    const only = note({ id: "only", tags: ["focus"] });
    const plan = planNoteTagRename([merged, only], "focus", "reading");
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.mergedIds).toEqual(["both"]);
    expect(plan.notes.map((row) => row.id)).toEqual(["both", "only"]);
  });
});

describe("noteTagsAfterRename", () => {
  it("preserves position, dedupes a merge, and matches the source ignoring case", () => {
    expect(noteTagsAfterRename(["alpha", "Focus", "beta"], "focus", "reading")).toEqual([
      "alpha",
      "reading",
      "beta",
    ]);
    expect(noteTagsAfterRename(["reading", "Focus"], "focus", "reading")).toEqual(["reading"]);
    expect(noteTagsAfterRename(["FOCUS"], "focus", "reading")).toEqual(["reading"]);
  });
});
