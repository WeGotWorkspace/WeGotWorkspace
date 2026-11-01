import { describe, expect, it } from "vitest";
import { pageCountIsStale, pageEndForBreak } from "./text-editor-page-break-fill";
import { tableRowPositions } from "./text-editor-page-rows";
import { getSchema } from "@tiptap/core";
import { createTextEditorExtensions } from "./text-editor-extensions";

const ENDS = [
  { top: 1000, bottom: 1250 },
  { top: 2100, bottom: 2350 },
  { top: 3200, bottom: 3300 },
];
const FALLBACK = { pagePeriod: 1100, pageEndHeight: 250 };

describe("pageEndForBreak", () => {
  it("fills to the end of the page the content stops on", () => {
    expect(pageEndForBreak(400, false, ENDS, FALLBACK)).toEqual(ENDS[0]);
    expect(pageEndForBreak(1500, false, ENDS, FALLBACK)).toEqual(ENDS[1]);
  });

  it("content that ends right at a page end stays on that page", () => {
    expect(pageEndForBreak(1000, false, ENDS, FALLBACK)).toEqual(ENDS[0]);
  });

  it("a break right after a break moves on a page, leaving an empty page", () => {
    expect(pageEndForBreak(1000, true, ENDS, FALLBACK)).toEqual(ENDS[1]);
  });

  it("projects page ends the library has not drawn yet", () => {
    expect(pageEndForBreak(3500, false, ENDS, FALLBACK)).toEqual({ top: 4300, bottom: 4550 });
    expect(pageEndForBreak(5000, false, ENDS, FALLBACK)).toEqual({ top: 5400, bottom: 5650 });
  });

  it("without any page end, fills nothing", () => {
    expect(pageEndForBreak(300, false, [], FALLBACK)).toEqual({ top: 299.5, bottom: 299.5 });
  });
});

describe("pageCountIsStale", () => {
  it("is stale when content runs past the last page", () => {
    expect(pageCountIsStale(3250, ENDS)).toBe(true);
  });

  it("is stale when the last page is empty", () => {
    expect(pageCountIsStale(1800, ENDS)).toBe(true);
  });

  it("holds when content ends on the last page", () => {
    expect(pageCountIsStale(2600, ENDS)).toBe(false);
    expect(pageCountIsStale(3200, ENDS)).toBe(false);
    expect(pageCountIsStale(500, [])).toBe(false);
  });
});

describe("tableRowPositions", () => {
  it("finds the rows of top-level tables", () => {
    const schema = getSchema(createTextEditorExtensions({ format: "markdown" }));
    const cell = (text: string) =>
      schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
    const row = (a: string) => schema.nodes.tableRow.create(null, [cell(a), cell(a)]);
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("Intro")),
      schema.nodes.table.create(null, [row("1"), row("2")]),
    ]);
    const positions = tableRowPositions(doc);
    expect(positions).toHaveLength(2);
    expect(positions.map((pos) => doc.nodeAt(pos)?.type.name)).toEqual(["tableRow", "tableRow"]);
  });
});
