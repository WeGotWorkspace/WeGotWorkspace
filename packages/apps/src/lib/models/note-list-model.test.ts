import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import {
  backfillNotesContentFromServer,
  computeExcerpt,
  isPlaceholderNoteListLabel,
  notesWithRenamedNotebook,
  preserveLocalListableBodiesOnServerNotes,
} from "@/lib/models/note-list-model";

function note(id: string, body: string[], fields: Partial<Note> = {}): Note {
  return {
    id,
    category: "",
    date: "2026-11-16T10:00:00Z",
    excerpt: "",
    body,
    notebook: "General",
    tags: [],
    wordCount: 0,
    ...fields,
  };
}

describe("isPlaceholderNoteListLabel", () => {
  it("treats blank, Untitled, the note id and local ids as placeholders", () => {
    expect(isPlaceholderNoteListLabel("  ")).toBe(true);
    expect(isPlaceholderNoteListLabel("untitled")).toBe(true);
    expect(isPlaceholderNoteListLabel("abc", "abc")).toBe(true);
    expect(isPlaceholderNoteListLabel("local-12ab-34")).toBe(true);
    expect(isPlaceholderNoteListLabel("Groceries", "abc")).toBe(false);
  });
});

describe("computeExcerpt", () => {
  it("truncates long text with an ellipsis", () => {
    expect(computeExcerpt(["short"])).toBe("short");
    const long = computeExcerpt(["x".repeat(300)]);
    expect(long).toHaveLength(180);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("backfillNotesContentFromServer", () => {
  it("keeps the local note when neither side has a listable body", () => {
    const [merged] = backfillNotesContentFromServer(
      [note("n1", [""], { title: "Local" })],
      [note("n1", ["  "], { title: "Server" })],
    );
    expect(merged.title).toBe("Local");
    expect(merged.body).toEqual([""]);
    expect(merged.wordCount).toBe(0);
  });

  it("appends server notes the local list does not have yet", () => {
    const merged = backfillNotesContentFromServer(
      [note("n1", ["Local body"])],
      [note("n1", ["Server body"]), note("n2", ["Only on the server"])],
    );
    expect(merged.map((row) => row.id)).toEqual(["n1", "n2"]);
    expect(merged[0].body).toEqual(["Local body"]);
    expect(merged[1].excerpt).toBe("Only on the server");
    expect(merged[1].wordCount).toBe(4);
  });
});

describe("preserveLocalListableBodiesOnServerNotes", () => {
  it("keeps the empty server body when there is no local note", () => {
    const [kept] = preserveLocalListableBodiesOnServerNotes([note("n1", [""])], []);
    expect(kept.body).toEqual([""]);
  });

  it("keeps the empty server body when the local note has no listable body either", () => {
    const [kept] = preserveLocalListableBodiesOnServerNotes(
      [note("n1", [""], { title: "Server" })],
      [note("n1", ["Untitled"], { title: "Local" })],
    );
    expect(kept.title).toBe("Server");
    expect(kept.body).toEqual([""]);
  });
});

describe("notesWithRenamedNotebook", () => {
  const notes = [note("n1", ["a"], { notebook: "Work" })];

  it("returns the same list when the new name is blank", () => {
    expect(notesWithRenamedNotebook(notes, { fromName: "Work", toName: "  " })).toBe(notes);
  });

  it("returns the same list when the name did not change", () => {
    expect(notesWithRenamedNotebook(notes, { fromName: "Work", toName: " Work " })).toBe(notes);
  });

  it("renames notes in the renamed notebook", () => {
    expect(
      notesWithRenamedNotebook(notes, { fromName: "Work", toName: "Projects" })[0].notebook,
    ).toBe("Projects");
  });
});
