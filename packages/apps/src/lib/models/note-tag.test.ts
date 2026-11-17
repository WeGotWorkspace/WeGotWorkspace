import { describe, expect, it } from "vitest";
import { noteTagDelta, noteTagToggle } from "@/lib/models/note-tag";

describe("noteTagToggle", () => {
  it("adds a new tag in lower case and labels it that way", () => {
    expect(noteTagToggle(["work"], " Travel ")).toEqual({
      tags: ["work", "travel"],
      added: true,
      label: "travel",
    });
  });

  it("removes a tag that is already on the note, ignoring case, and labels it as typed", () => {
    expect(noteTagToggle(["work", "travel"], " WORK ")).toEqual({
      tags: ["travel"],
      added: false,
      label: "WORK",
    });
  });

  it("returns null for an invalid new tag", () => {
    expect(noteTagToggle(["work"], "no spaces")).toBeNull();
    expect(noteTagToggle(["work"], "  ")).toBeNull();
  });

  it("in add mode, adds a new tag but never removes an existing one", () => {
    expect(noteTagToggle([], "home", "add")).toEqual({
      tags: ["home"],
      added: true,
      label: "home",
    });
    expect(noteTagToggle(["home"], "Home", "add")).toBeNull();
  });
});

describe("noteTagDelta", () => {
  it("sends an added tag as tagsAdd", () => {
    expect(noteTagDelta({ added: true, label: "travel" })).toEqual({ tagsAdd: ["travel"] });
  });

  it("sends a removed tag as tagsRemove, normalized", () => {
    expect(noteTagDelta({ added: false, label: " WORK " })).toEqual({ tagsRemove: ["work"] });
  });
});
