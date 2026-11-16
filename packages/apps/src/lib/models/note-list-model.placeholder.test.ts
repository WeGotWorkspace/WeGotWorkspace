import { describe, expect, it } from "vitest";
import { computeExcerpt, isPlaceholderNoteListLabel } from "@/lib/models/note-list-model";

describe("note-list-model", () => {
  it("treats blank, Untitled, the note id and local ids as placeholders", () => {
    expect(isPlaceholderNoteListLabel("  ")).toBe(true);
    expect(isPlaceholderNoteListLabel("untitled")).toBe(true);
    expect(isPlaceholderNoteListLabel("abc", "abc")).toBe(true);
    expect(isPlaceholderNoteListLabel("local-12ab-34")).toBe(true);
    expect(isPlaceholderNoteListLabel("Groceries", "abc")).toBe(false);
  });

  it("computeExcerpt truncates long text with an ellipsis", () => {
    expect(computeExcerpt(["short"])).toBe("short");
    const long = computeExcerpt(["x".repeat(300)]);
    expect(long).toHaveLength(180);
    expect(long.endsWith("…")).toBe(true);
  });
});
