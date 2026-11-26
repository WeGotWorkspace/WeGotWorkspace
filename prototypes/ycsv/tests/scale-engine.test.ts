import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { evaluateAll } from "../src/ycsv-formula";
import { fileToDoc, insertRowAfter } from "../src/ycsv-model";
import { buildScaleFile } from "../src/scale/generate";
import { SheetEngine, deleteRowAt, pasteBlock, setCellAt } from "../src/scale/engine";

function colId(doc: Y.Doc, ref: string): string {
  const cols = doc.getArray<Y.Map<unknown>>("columns").toArray();
  return String(cols.find((c) => c.get("ref") === ref)?.get("colId"));
}

function expectSameAsFull(engine: SheetEngine) {
  const full = evaluateAll(engine.raw, engine.rowIds, {}, engine.columns.map((c) => c.ref));
  const mine = engine.valuesAsMap();
  expect(mine.size).toBe(full.size);
  for (const [key, value] of full) expect(mine.get(key), key).toEqual(value);
}

describe("SheetEngine incremental", () => {
  for (const width of [10, 30] as const) {
    it(`matches evaluateAll after edits, inserts, deletes, paste (${width} cols)`, () => {
      const doc = new Y.Doc();
      fileToDoc(buildScaleFile(200, width), doc);
      const engine = new SheetEngine(doc, "incremental");
      expectSameAsFull(engine);
      const aantal = colId(doc, "aantal");
      const tarief = colId(doc, "tarief");
      const netto = colId(doc, "netto");
      const rowId = (i: number) => engine.rowIds[i] as string;

      setCellAt(doc, 17, aantal, "99");
      expectSameAsFull(engine);
      expect(engine.stats.lastEvaluated).toBeLessThan(20);
      setCellAt(doc, 0, tarief, "0.09");
      expectSameAsFull(engine);
      insertRowAfter(doc, 50);
      expectSameAsFull(engine);
      setCellAt(doc, 51, aantal, "5");
      setCellAt(doc, 51, colId(doc, "prijs"), "2");
      setCellAt(doc, 51, netto, `=aantal@${rowId(51)}*prijs@${rowId(51)}`);
      expectSameAsFull(engine);
      deleteRowAt(doc, 120);
      expectSameAsFull(engine);
      // Deleting the range end row turns the aggregate into #REF.
      deleteRowAt(doc, engine.rowIds.length - 1);
      expectSameAsFull(engine);
      pasteBlock(doc, 10, [aantal, colId(doc, "prijs")], Array.from({ length: 30 }, (_, i) => [String(i), "1.5"]));
      expectSameAsFull(engine);
      // A cycle and its repair.
      setCellAt(doc, 3, aantal, `=netto@${rowId(3)}`);
      expectSameAsFull(engine);
      expect(engine.getValue(`aantal@${rowId(3)}`)).toBe("#CYCLE");
      setCellAt(doc, 3, aantal, "4");
      expectSameAsFull(engine);
      engine.destroy();
    });
  }

  it("full mode matches too", () => {
    const doc = new Y.Doc();
    fileToDoc(buildScaleFile(100, 10), doc);
    const engine = new SheetEngine(doc, "full");
    setCellAt(doc, 5, colId(doc, "aantal"), "7");
    expectSameAsFull(engine);
  });
});
