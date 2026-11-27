import { expect, it } from "vitest";
import { evaluateAll } from "../src/ycsv-formula";

// Running balance: saldo@r_i = saldo@r_{i-1} + bedrag@r_i. The dependency chain is as deep as the sheet.
function chain(rows: number, reversed = false) {
  const raw = new Map<string, string>();
  const ids = Array.from({ length: rows }, (_, i) => `r${i}`);
  ids.forEach((id, i) => {
    raw.set(`bedrag@${id}`, "1");
    if (reversed) raw.set(`saldo@${id}`, i === rows - 1 ? "=bedrag" : `=saldo@${ids[i + 1]}+bedrag`);
    else raw.set(`saldo@${id}`, i === 0 ? "=bedrag" : `=saldo@${ids[i - 1]}+bedrag`);
  });
  return { raw, ids };
}

for (const rows of [1000, 5000, 10000, 50000]) {
  it(`evaluateAll survives a ${rows}-deep running balance`, () => {
    const { raw, ids } = chain(rows);
    let result: unknown;
    try {
      result = evaluateAll(raw, ids, {}, ["bedrag", "saldo"]).get(`saldo@${ids[rows - 1]}`);
    } catch (error) {
      result = error instanceof Error ? error.message : String(error);
    }
    expect(result).toBe(rows);
  });
}

// Bottom-up chain (each row reads the row below): evaluateAll's recursive visit goes as deep as the sheet.
for (const rows of [1000, 5000, 10000, 50000]) {
  it(`evaluateAll on a ${rows}-deep bottom-up chain`, () => {
    const { raw, ids } = chain(rows, true);
    let result: unknown;
    try {
      result = evaluateAll(raw, ids, {}, ["bedrag", "saldo"]).get(`saldo@${ids[0]}`);
    } catch (error) {
      result = error instanceof Error ? error.message : String(error);
    }
    console.log(`bottom-up ${rows}:`, result);
  });
}

import * as Y from "yjs";
import { SheetEngine } from "../src/scale/engine";

it("the incremental engine loads and edits a 50,000-deep bottom-up chain", () => {
  const rows = 50000;
  const doc = new Y.Doc();
  const colsArr = doc.getArray<Y.Map<unknown>>("columns");
  const rowsArr = doc.getArray<Y.Map<unknown>>("rows");
  const ids = Array.from({ length: rows }, (_, i) => `r${i}`);
  doc.transact(() => {
    for (const ref of ["bedrag", "saldo"]) {
      const m = new Y.Map<unknown>();
      m.set("colId", `c_${ref}`);
      m.set("ref", ref);
      colsArr.push([m]);
    }
    rowsArr.push(
      ids.map((id, i) => {
        const cells = new Y.Map<string>();
        cells.set("c_bedrag", "1");
        cells.set("c_saldo", i === rows - 1 ? "=bedrag" : `=saldo@${ids[i + 1]}+bedrag`);
        const row = new Y.Map<unknown>();
        row.set("rowId", id);
        row.set("cells", cells);
        return row;
      }),
    );
  });
  const engine = new SheetEngine(doc, "incremental");
  expect(engine.getValue(`saldo@${ids[0]}`)).toBe(rows);
  const t = performance.now();
  (rowsArr.get(rows - 1).get("cells") as Y.Map<string>).set("c_bedrag", "2");
  console.log(`chain edit at the bottom: ${(performance.now() - t).toFixed(1)} ms, ${engine.stats.lastEvaluated} cells`);
  expect(engine.getValue(`saldo@${ids[0]}`)).toBe(rows + 1);
});
