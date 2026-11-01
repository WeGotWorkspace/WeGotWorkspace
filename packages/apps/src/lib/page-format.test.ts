import { describe, expect, it } from "vitest";
import {
  TEXT_EDITOR_PAGE_FORMATS,
  defaultTextEditorPageFormat,
  isTextEditorPageFormat,
  isTextEditorPageLayout,
  isTextEditorPageOrientation,
  textEditorPageBox,
  textEditorPageCssRule,
} from "@/lib/page-format";

describe("page format table", () => {
  it.each([
    ["a4", 794, 1123],
    ["a3", 1123, 1587],
    ["a5", 559, 794],
    ["letter", 816, 1056],
    ["legal", 816, 1344],
  ] as const)("%s portrait is %i × %i CSS px with a 1 inch margin", (format, width, height) => {
    expect(textEditorPageBox({ format, orientation: "portrait" })).toEqual({
      width,
      height,
      margin: 96,
    });
  });

  it("swaps width and height in landscape", () => {
    expect(textEditorPageBox({ format: "a4", orientation: "landscape" })).toEqual({
      width: 1123,
      height: 794,
      margin: 96,
    });
  });

  it("writes the print @page rule", () => {
    expect(textEditorPageCssRule({ format: "letter", orientation: "landscape" })).toBe(
      "@page { size: letter landscape; margin: 1in !important; }",
    );
    expect(textEditorPageCssRule({ format: "a5", orientation: "portrait" })).toBe(
      "@page { size: A5 portrait; margin: 1in !important; }",
    );
  });

  it("offers the five formats", () => {
    expect(TEXT_EDITOR_PAGE_FORMATS).toEqual(["a4", "a3", "a5", "letter", "legal"]);
  });
});

describe("defaultTextEditorPageFormat", () => {
  it.each([
    [["en-US"], "letter"],
    [["en-CA"], "letter"],
    [["fr-CA"], "letter"],
    [["en"], "letter"],
    [["nl-NL"], "a4"],
    [["nl"], "a4"],
    [["en-GB"], "a4"],
    [["de-DE", "en-US"], "a4"],
    [[], "a4"],
    [["not a locale!"], "a4"],
  ] as const)("%j → %s", (locales, expected) => {
    expect(defaultTextEditorPageFormat(locales)).toBe(expected);
  });
});

describe("type guards", () => {
  it("accept known values only", () => {
    expect(isTextEditorPageFormat("legal")).toBe(true);
    expect(isTextEditorPageFormat("b5")).toBe(false);
    expect(isTextEditorPageOrientation("landscape")).toBe(true);
    expect(isTextEditorPageOrientation(1)).toBe(false);
    expect(isTextEditorPageLayout("continuous")).toBe(true);
    expect(isTextEditorPageLayout("scroll")).toBe(false);
  });
});
