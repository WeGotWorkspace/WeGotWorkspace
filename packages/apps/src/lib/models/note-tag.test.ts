import { describe, expect, it } from "vitest";
import {
  isValidNewTag,
  noteTagDelta,
  noteTagToggle,
  noteTagsAfterAdd,
  noteTagsAfterToggle,
  normalizeTag,
} from "@/lib/models/note-tag";

describe("note-tag", () => {
  it("normalizes and validates", () => {
    expect(normalizeTag("  Foo ")).toBe("foo");
    expect(isValidNewTag("foo-bar")).toBe(true);
    expect(isValidNewTag("")).toBe(false);
    expect(isValidNewTag("foo1")).toBe(false);
    expect(isValidNewTag("a".repeat(256))).toBe(false);
  });

  it("noteTagsAfterToggle adds, removes and rejects", () => {
    expect(noteTagsAfterToggle(["a"], "  ")).toBeNull();
    expect(noteTagsAfterToggle(["a"], "B")).toEqual(["a", "b"]);
    expect(noteTagsAfterToggle(["a", "b"], "A")).toEqual(["b"]);
    expect(noteTagsAfterToggle(["a"], "b1")).toBeNull();
  });

  it("noteTagsAfterAdd rejects invalid and duplicates", () => {
    expect(noteTagsAfterAdd(["a"], "b1")).toBeNull();
    expect(noteTagsAfterAdd(["a"], "A")).toBeNull();
    expect(noteTagsAfterAdd(["a"], "B")).toEqual(["a", "b"]);
  });

  it("noteTagToggle reports added/removed and the label", () => {
    expect(noteTagToggle(["a"], "B")).toEqual({ tags: ["a", "b"], added: true, label: "b" });
    expect(noteTagToggle(["a"], "a")).toEqual({ tags: [], added: false, label: "a" });
    expect(noteTagToggle(["a"], "a", "add")).toBeNull();
    expect(noteTagToggle(["a"], "b", "add")?.added).toBe(true);
  });

  it("noteTagDelta emits add or remove", () => {
    expect(noteTagDelta({ added: true, label: "X" })).toEqual({ tagsAdd: ["x"] });
    expect(noteTagDelta({ added: false, label: "X" })).toEqual({ tagsRemove: ["x"] });
  });
});
