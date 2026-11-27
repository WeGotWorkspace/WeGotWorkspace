import { describe, expect, it } from "vitest";
import { tagDelta, tagToggle } from "./tag-rules";

describe("tagToggle", () => {
  it("adds a new tag in lower case and labels it that way", () => {
    expect(tagToggle(["work"], " Travel ")).toEqual({
      tags: ["work", "travel"],
      added: true,
      label: "travel",
    });
  });

  it("removes a tag that is already on the note, ignoring case, and labels it as typed", () => {
    expect(tagToggle(["work", "travel"], " WORK ")).toEqual({
      tags: ["travel"],
      added: false,
      label: "WORK",
    });
  });

  it("returns null for an invalid new tag", () => {
    expect(tagToggle(["work"], "no spaces")).toBeNull();
    expect(tagToggle(["work"], "  ")).toBeNull();
  });

  it("in add mode, adds a new tag but never removes an existing one", () => {
    expect(tagToggle([], "home", "add")).toEqual({
      tags: ["home"],
      added: true,
      label: "home",
    });
    expect(tagToggle(["home"], "Home", "add")).toBeNull();
  });
});

describe("tagDelta", () => {
  it("sends an added tag as tagsAdd", () => {
    expect(tagDelta({ added: true, label: "travel" })).toEqual({ tagsAdd: ["travel"] });
  });

  it("sends a removed tag as tagsRemove, normalized", () => {
    expect(tagDelta({ added: false, label: " WORK " })).toEqual({ tagsRemove: ["work"] });
  });
});
