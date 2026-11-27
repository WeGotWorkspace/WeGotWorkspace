import { describe, expect, it } from "vitest";
import { hasTagDelta, mergeTagDeltas } from "./tag-delta";

describe("mergeTagDeltas", () => {
  it("lets the later operation win for one tag", () => {
    expect(mergeTagDeltas({ tagsAdd: ["a"] }, { tagsRemove: ["a"] })).toEqual({
      tagsRemove: ["a"],
    });
    expect(mergeTagDeltas({ tagsRemove: ["a"] }, { tagsAdd: ["A"] })).toEqual({
      tagsAdd: ["a"],
    });
  });

  it("keeps adds of different tags from two edits", () => {
    expect(mergeTagDeltas({ tagsAdd: ["a"] }, { tagsAdd: ["b"] })).toEqual({
      tagsAdd: ["a", "b"],
    });
  });

  it("reports whether a delta changes anything", () => {
    expect(hasTagDelta({})).toBe(false);
    expect(hasTagDelta({ tagsRemove: ["x"] })).toBe(true);
  });
});
