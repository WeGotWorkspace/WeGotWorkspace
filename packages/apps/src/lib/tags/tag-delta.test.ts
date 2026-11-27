import { describe, expect, it } from "vitest";
import { hasTagDelta, invertTagDelta, mergeTagDeltas, tagsAfterDelta } from "./tag-delta";

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

describe("tagsAfterDelta", () => {
  it("removes first, then adds, normalised and without repeats", () => {
    expect(tagsAfterDelta(["a", "b"], { tagsRemove: ["B"], tagsAdd: ["C", "a", "c"] })).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("invertTagDelta", () => {
  it("is the delta that restores the tags from before", () => {
    const before = ["keep", "gone"];
    const delta = { tagsRemove: ["gone"], tagsAdd: ["fresh"] };
    const after = tagsAfterDelta(before, delta);
    expect(tagsAfterDelta(after, invertTagDelta(before, after)).sort()).toEqual([...before].sort());
    expect(invertTagDelta(before, before)).toEqual({});
  });
});
