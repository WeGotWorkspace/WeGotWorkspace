// Probe: where fileToDoc time goes as rows grow.
import * as Y from "yjs";
import { fileToDoc } from "../../src/ycsv-model";
import { toIdForm } from "../../src/ycsv-model/refs";
import { buildScaleFile } from "../../src/scale/generate";

for (const rows of [5000, 10000, 20000]) {
  const file = buildScaleFile(rows, 10);
  let t = performance.now();
  fileToDoc(file, new Y.Doc());
  const full = performance.now() - t;
  const cols = file.columns.map((c, i) => ({ colId: `c${i}`, ref: c.ref ?? "" }));
  const rowIds = file.rows.map((_, i) => `r_${i}`);
  t = performance.now();
  for (const row of file.rows) for (const cell of row) toIdForm(cell, cols, rowIds);
  const ids = performance.now() - t;
  const doc = new Y.Doc();
  t = performance.now();
  doc.transact(() => {
    const arr = doc.getArray<Y.Map<unknown>>("rows");
    for (let i = 0; i < rows; i++) {
      const cells = new Y.Map<string>();
      for (let c = 0; c < 10; c++) cells.set(`c${c}`, "x");
      const m = new Y.Map<unknown>();
      m.set("rowId", rowIds[i]);
      m.set("cells", cells);
      arr.push([m]);
    }
  });
  const yjsPush = performance.now() - t;
  console.log(rows, "fileToDoc", full.toFixed(0), "toIdForm", ids.toFixed(0), "yjs push-per-row", yjsPush.toFixed(0));
}
