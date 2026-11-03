import { describe, expect, it } from "vitest";
import { remoteSelectionAttrs } from "./text-editor-extensions";

describe("remoteSelectionAttrs", () => {
  it("marks the selection with our class and the person's color", () => {
    expect(remoteSelectionAttrs({ name: "Grace", color: "#9333ea" })).toEqual({
      nodeName: "span",
      class: "collaboration-carets__selection",
      style: "--collaboration-carets-color: #9333ea",
    });
  });

  it("drops a color that is not a plain hex color", () => {
    for (const color of ["red; background-image: url(x)", "", 12, undefined]) {
      expect(remoteSelectionAttrs({ color })).toEqual({
        nodeName: "span",
        class: "collaboration-carets__selection",
      });
    }
  });
});
