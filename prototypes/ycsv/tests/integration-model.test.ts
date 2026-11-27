import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { WorkbookEngine } from "../src/sheets-core/engine/engine";
import {
  addSheet,
  deleteRows,
  docToText,
  insertColumns,
  insertRows,
  moveRows,
  renameSheet,
  sheetCells,
  sheetIdByRef,
  sheetIds,
  sortRows,
  textToDoc,
  writeCells,
  docRefScope,
  bookToIdForm,
  repairWorkbook,
} from "../src/sheets-core/model";

const MULTI = `---
ycsv_version: 1
defs:
  btw: 0.21
sheets:
  - ref: producten
    name: Productenoverzicht
    columns:
      - ref: product
        type: string
      - ref: categorie
        type: string
      - ref: prijs
        type: number
      - ref: totaal_incl
        type: number
      - ref: label
        type: string
  - ref: categorieën
    columns:
      - ref: id
        type: string
      - ref: label
        type: string
      - ref: aantal
        type: number
---
product,categorie,prijs,totaal_incl,label
Appels,fruit,0.45,=prijs1*(1+btw),=categorieën!label1
Brood,bakkerij,2.99,=prijs2*(1+btw),=categorieën!label2
Melk,zuivel,1.19,=prijs3*(1+btw),=SUM(categorieën!aantal1:categorieën!aantal3)
---
id,label,aantal
fruit,Fruit,1
bakkerij,Bakkerij,2
zuivel,Zuivel,3
`;

function book(text = MULTI): { doc: Y.Doc; p: string; c: string } {
  const doc = new Y.Doc();
  textToDoc(text, doc);
  return { doc, p: sheetIdByRef(doc, "producten") as string, c: sheetIdByRef(doc, "categorieën") as string };
}

const rowId = (doc: Y.Doc, sheet: string, r: number) => docRefScope(doc, sheet).self.rowIds[r] as string;
const colId = (doc: Y.Doc, sheet: string, ref: string) => docRefScope(doc, sheet).self.cols.find((c) => c.ref === ref)?.colId as string;

describe("integration slice: multi-sheet workbook", () => {
  it("round-trips the spec's multi-sheet file", () => {
    const { doc } = book();
    expect(sheetIds(doc)).toHaveLength(2);
    expect(docToText(doc)).toBe(MULTI);
  });

  it("round-trips a single-sheet file byte for byte", () => {
    const single = `---\nycsv_version: 1\nname: Q3\ncolumns:\n  - ref: a\n  - ref: b\n---\na,b\n1,=a1*2\n`;
    const doc = new Y.Doc();
    textToDoc(single, doc);
    expect(docToText(doc)).toBe(single);
  });

  it("stores cross-sheet refs by sheet id, so a sheet rename keeps formulas", () => {
    const { doc, p, c } = book();
    const raw = docRefScope(doc, p);
    expect(bookToIdForm("=categorieën!label1", raw)).toMatch(new RegExp(`^=${c}!label@r_`));
    renameSheet(doc, c, "cats");
    expect(sheetCells(doc, p)[0]?.[4]).toBe("=cats!label1");
  });

  it("evaluates cross-sheet point refs and ranges, and updates them incrementally", () => {
    const { doc, p, c } = book();
    const engine = new WorkbookEngine(doc);
    expect(engine.value(p, "label", rowId(doc, p, 0))).toBe("Fruit");
    expect(engine.value(p, "label", rowId(doc, p, 2))).toBe(6);
    writeCells({ doc, id: c }, [{ rowId: rowId(doc, c, 1), colId: colId(doc, c, "aantal"), value: "20" }]);
    expect(engine.value(p, "label", rowId(doc, p, 2))).toBe(24);
    writeCells({ doc, id: c }, [{ rowId: rowId(doc, c, 0), colId: colId(doc, c, "label"), value: "Vers fruit" }]);
    expect(engine.value(p, "label", rowId(doc, p, 0))).toBe("Vers fruit");
    // A row inserted inside the range on the other sheet joins it.
    const [added] = insertRows({ doc, id: c }, 1, 1);
    writeCells({ doc, id: c }, [{ rowId: added as string, colId: colId(doc, c, "aantal"), value: "100" }]);
    expect(engine.value(p, "label", rowId(doc, p, 2))).toBe(124);
    expect(engine.valuesAsMap()).toEqual(new WorkbookEngine(doc).valuesAsMap());
  });

  it("a sort rewrites ranges that point into the sorted sheet from another sheet", () => {
    const { doc, p, c } = book();
    sortRows({ doc, id: c }, colId(doc, c, "aantal"), true);
    expect(sheetCells(doc, c).map((row) => row[2])).toEqual(["3", "2", "1"]);
    expect(sheetCells(doc, p)[2]?.[4]).toBe("=SUM(categorieën!aantal1:categorieën!aantal3)");
    const engine = new WorkbookEngine(doc);
    expect(engine.value(p, "label", rowId(doc, p, 2))).toBe(6);
    // Point refs follow their row: Appels still shows Fruit.
    expect(engine.value(p, "label", rowId(doc, p, 0))).toBe("Fruit");
  });

  it("deleting a referenced sheet gives #REF, adding one works", () => {
    const { doc, p, c } = book();
    const engine = new WorkbookEngine(doc);
    const extra = addSheet(doc, { ref: "extra" });
    expect(sheetIds(doc)).toEqual([p, c, extra]);
    doc.transact(() => {
      doc.getArray<string>("sheetOrder").delete(1, 1);
      doc.getMap("sheets").delete(c);
    });
    expect(engine.value(p, "label", rowId(doc, p, 0))).toBe("#REF");
    expect(sheetCells(doc, p)[0]?.[4]).toBe("=#REF!");
  });

  it("random edits, moves, inserts, deletes and sorts: incremental equals a fresh build", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < Number(process.env.FUZZ_RUNS ?? 60); run += 1) {
      const { doc, p, c } = book();
      const engine = new WorkbookEngine(doc);
      for (let step = 0; step < 40; step += 1) {
        const sheet = rnd() < 0.5 ? p : c;
        const rows = docRefScope(doc, sheet).self.rowIds.length;
        const op = rnd();
        if (op < 0.5 && rows > 0) {
          const cols = docRefScope(doc, sheet).self.cols;
          const col = cols[Math.floor(rnd() * cols.length)]!;
          const r = Math.floor(rnd() * rows);
          const choices = ["5", "", "x", `=SUM(${sheet === p ? "categorieën!" : ""}aantal1:${sheet === p ? "categorieën!" : ""}aantal2)`, "=prijs1*2"];
          const text = choices[Math.floor(rnd() * choices.length)]!;
          const scope = docRefScope(doc, sheet);
          writeCells({ doc, id: sheet }, [{ rowId: scope.self.rowIds[r]!, colId: col.colId, value: bookToIdForm(text, scope) }]);
        } else if (op < 0.65) insertRows({ doc, id: sheet }, Math.floor(rnd() * (rows + 1)), 1 + Math.floor(rnd() * 2));
        else if (op < 0.75 && rows > 1) deleteRows({ doc, id: sheet }, [Math.floor(rnd() * rows)]);
        else if (op < 0.9 && rows > 1) moveRows({ doc, id: sheet }, Math.floor(rnd() * rows), 1, Math.floor(rnd() * rows));
        else if (op < 0.95) sortRows({ doc, id: sheet }, docRefScope(doc, sheet).self.cols[0]!.colId, rnd() < 0.5);
        else insertColumns({ doc, id: sheet }, 1, 1);
      }
      const fresh = new WorkbookEngine(doc).valuesAsMap();
      expect(engine.valuesAsMap()).toEqual(fresh);
      expect(repairWorkbook(doc)).toBe(0);
    }
  });
});
