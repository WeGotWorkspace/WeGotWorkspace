// Probe: Y.Array push per row vs one batched push, inside one transaction.
import * as Y from "yjs";

function build(rows: number, batched: boolean): number {
  const doc = new Y.Doc();
  const t = performance.now();
  doc.transact(() => {
    const arr = doc.getArray<Y.Map<unknown>>("rows");
    const all: Y.Map<unknown>[] = [];
    for (let i = 0; i < rows; i++) {
      const cells = new Y.Map<string>();
      for (let c = 0; c < 10; c++) cells.set(`c${c}`, "x");
      const m = new Y.Map<unknown>();
      m.set("rowId", `r_${i}`);
      m.set("cells", cells);
      if (batched) all.push(m);
      else arr.push([m]);
    }
    if (batched) arr.push(all);
  });
  return performance.now() - t;
}
for (const rows of [5000, 10000, 20000, 50000]) {
  console.log(rows, "per-row", rows <= 20000 ? build(rows, false).toFixed(0) : "skip", "batched", build(rows, true).toFixed(0));
}
