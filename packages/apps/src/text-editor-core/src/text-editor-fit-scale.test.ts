/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  TEXT_EDITOR_FIT_SCALE_VAR,
  textEditorFitScale,
  textEditorScreenScale,
} from "@/text-editor-core/src/text-editor-fit-scale";

describe("textEditorFitScale", () => {
  it("shrinks a page wider than the space to fit it", () => {
    expect(textEditorFitScale(371, 794)).toBe(0.467);
  });

  it("never grows a page that already fits", () => {
    expect(textEditorFitScale(1200, 794)).toBe(1);
    expect(textEditorFitScale(794, 794)).toBe(1);
  });

  it("leaves the page alone while there is nothing to measure", () => {
    expect(textEditorFitScale(0, 794)).toBe(1);
    expect(textEditorFitScale(371, 0)).toBe(1);
  });
});

describe("textEditorScreenScale", () => {
  it("reads the fitted scale, else 1", () => {
    const dom = document.createElement("div");
    expect(textEditorScreenScale(dom)).toBe(1);
    dom.style.setProperty(TEXT_EDITOR_FIT_SCALE_VAR, "0.5");
    expect(textEditorScreenScale(dom)).toBe(0.5);
  });
});
