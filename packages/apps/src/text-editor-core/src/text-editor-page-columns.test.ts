import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { CELL_WIDTH_VAR, cellWidthDecorations, topLevelTables } from "./text-editor-page-columns";

const schema = getSchema(createTextEditorExtensions({ format: "markdown" }));
const cell = (text: string, colspan = 1) =>
  schema.nodes.tableCell.create(
    { colspan },
    schema.nodes.paragraph.create(null, schema.text(text)),
  );
const row = (...cells: ReturnType<typeof cell>[]) => schema.nodes.tableRow.create(null, cells);
const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));

function styles(decorations: ReturnType<typeof cellWidthDecorations>) {
  return decorations.map(
    (decoration) =>
      (decoration as unknown as { type: { attrs: { style: string } } }).type.attrs.style,
  );
}

describe("topLevelTables", () => {
  it("finds tables with their positions", () => {
    const doc = schema.nodes.doc.create(null, [
      paragraph("Intro"),
      schema.nodes.table.create(null, [row(cell("a"), cell("b"))]),
    ]);
    const tables = topLevelTables(doc);
    expect(tables).toHaveLength(1);
    expect(doc.nodeAt(tables[0].pos)?.type.name).toBe("table");
  });
});

describe("cellWidthDecorations", () => {
  const doc = schema.nodes.doc.create(null, [
    paragraph("Intro"),
    schema.nodes.table.create(null, [
      row(cell("a"), cell("b"), cell("c")),
      row(cell("wide", 2), cell("d")),
    ]),
  ]);
  const pos = topLevelTables(doc)[0].pos;

  it("gives every cell the width of its column", () => {
    const decorations = cellWidthDecorations(doc, [{ pos, widths: [100, 200.125, 50] }]);
    expect(styles(decorations)).toEqual([
      `${CELL_WIDTH_VAR}: 100.00px`,
      `${CELL_WIDTH_VAR}: 200.13px`,
      `${CELL_WIDTH_VAR}: 50.00px`,
      `${CELL_WIDTH_VAR}: 300.13px`,
      `${CELL_WIDTH_VAR}: 50.00px`,
    ]);
    expect(decorations.map((d) => doc.nodeAt(d.from)?.type.name)).toEqual(
      Array(5).fill("tableCell"),
    );
  });

  it("skips widths that no longer fit the table", () => {
    expect(cellWidthDecorations(doc, [{ pos, widths: [100, 200] }])).toEqual([]);
    expect(cellWidthDecorations(doc, [{ pos: 0, widths: [1, 2, 3] }])).toEqual([]);
  });
});
