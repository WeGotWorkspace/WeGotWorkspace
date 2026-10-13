import { Awareness } from "y-protocols/awareness";
import { expect, test } from "vitest";
import * as Y from "yjs";
import { parse } from "../src/ycsv-core/parse";
import { serialize } from "../src/ycsv-core/serialize";
import { evaluateAll, type RawCells } from "../src/ycsv-formula";
import { docToFile, fileToDoc, setCell, insertRowAfter, deleteRow } from "../src/ycsv-model";
import { SEED } from "../src/stories/fixtures";
import { link } from "../src/stories/relay";

function flush(latency = 0) {
  return new Promise((resolve) => setTimeout(resolve, latency * 2 + 10));
}

function setup(latency = 0) {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  fileToDoc(parse(SEED), docA);
  const aw = new Awareness(docA);
  const bw = new Awareness(docB);
  const connection = link(docA, docB, aw, bw);
  connection.setLatency(latency);
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), "remote");
  expect(serialize(docToFile(docA))).toBe(serialize(docToFile(docB)));
  const columns = docA.getArray<Y.Map<unknown>>("columns");
  const col = (ref: string) => {
    for (let i = 0; i < columns.length; i += 1) {
      if (columns.get(i).get("ref") === ref) return String(columns.get(i).get("colId"));
    }
    throw new Error(`missing column ${ref}`);
  };
  const rowId = (doc: Y.Doc, index: number) =>
    String(doc.getArray<Y.Map<unknown>>("rows").get(index).get("rowId"));
  return {
    docA,
    docB,
    connection,
    colProduct: col("product"),
    colAantal: col("aantal"),
    colPrijs: col("prijs"),
    colTotaal: col("totaal"),
    rowId,
    close() {
      connection.destroy();
      aw.destroy();
      bw.destroy();
    },
  };
}

function valuesOf(doc: Y.Doc) {
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  const rows = doc.getArray<Y.Map<unknown>>("rows");
  const cols: { colId: string; ref: string }[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    const map = columns.get(i);
    cols.push({ colId: String(map.get("colId")), ref: String(map.get("ref")) });
  }
  const raw: RawCells = new Map();
  const rowOrder: string[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows.get(r);
    const id = String(row.get("rowId"));
    rowOrder.push(id);
    const cells = row.get("cells") as Y.Map<string>;
    for (const column of cols) raw.set(`${column.ref}@${id}`, cells.get(column.colId) ?? "");
  }
  const defs = doc.getMap("raw").get("defs");
  return evaluateAll(raw, rowOrder, defs && typeof defs === "object" ? (defs as Record<string, unknown>) : {});
}

test("T1 basis convergence", async () => {
  const ctx = setup();
  const rowA1 = ctx.rowId(ctx.docA, 0);
  setCell(ctx.docA, rowA1, ctx.colProduct, "Peren");
  await flush();
  expect(docToFile(ctx.docB).rows[0]?.[0]).toBe("Peren");
  ctx.close();
});

test("T2 different cells converge", async () => {
  const ctx = setup();
  setCell(ctx.docA, ctx.rowId(ctx.docA, 0), ctx.colProduct, "Peren");
  setCell(ctx.docB, ctx.rowId(ctx.docB, 1), ctx.colProduct, "Stoofperen");
  await flush();
  for (const doc of [ctx.docA, ctx.docB]) {
    const file = docToFile(doc);
    expect(file.rows[0]?.[0]).toBe("Peren");
    expect(file.rows[1]?.[0]).toBe("Stoofperen");
  }
  ctx.close();
});

test("T3 concurrent row insert keeps the formula on the same logical row", async () => {
  const ctx = setup();
  ctx.connection.setOffline("a", true);
  ctx.connection.setOffline("b", true);
  const row4 = ctx.rowId(ctx.docB, 3);
  insertRowAfter(ctx.docA, 0);
  setCell(ctx.docB, row4, ctx.colTotaal, "=aantal4*prijs4");
  ctx.connection.setOffline("a", false);
  ctx.connection.setOffline("b", false);
  await flush();
  const left = docToFile(ctx.docA);
  const right = docToFile(ctx.docB);
  expect(serialize(left)).toBe(serialize(right));
  expect(left.rows[4]?.[3]).toBe("=aantal5*prijs5");
  ctx.close();
});

test("T4 offline edits converge", async () => {
  const ctx = setup();
  ctx.connection.setOffline("a", true);
  ctx.connection.setOffline("b", true);
  setCell(ctx.docA, ctx.rowId(ctx.docA, 0), ctx.colProduct, "Peren");
  setCell(ctx.docA, ctx.rowId(ctx.docA, 0), ctx.colAantal, "9");
  setCell(ctx.docA, ctx.rowId(ctx.docA, 1), ctx.colPrijs, "3.10");
  setCell(ctx.docB, ctx.rowId(ctx.docB, 1), ctx.colProduct, "Roggebrood");
  setCell(ctx.docB, ctx.rowId(ctx.docB, 2), ctx.colAantal, "4");
  setCell(ctx.docB, ctx.rowId(ctx.docB, 3), ctx.colTotaal, "=aantal4*prijs4");
  ctx.connection.setOffline("a", false);
  ctx.connection.setOffline("b", false);
  await flush();
  expect(serialize(docToFile(ctx.docA))).toBe(serialize(docToFile(ctx.docB)));
  ctx.close();
});

test("T5 a formula pointing at a deleted row becomes #REF", async () => {
  const ctx = setup();
  const row2 = ctx.rowId(ctx.docA, 1);
  const row1 = ctx.rowId(ctx.docB, 0);
  deleteRow(ctx.docA, row2);
  setCell(ctx.docB, row1, ctx.colTotaal, "=aantal2*prijs2");
  await flush();
  const file = docToFile(ctx.docA);
  expect(serialize(file)).toBe(serialize(docToFile(ctx.docB)));
  expect(serialize(file)).toContain("#REF!");
  expect(valuesOf(ctx.docA).get(`totaal@${row1}`)).toBe("#REF");
  ctx.close();
});
