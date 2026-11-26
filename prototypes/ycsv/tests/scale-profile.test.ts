import { it } from "vitest";
import * as Y from "yjs";
import { fileToDoc } from "../src/ycsv-model";
import { buildScaleFile } from "../src/scale/generate";
import { SheetEngine, setCellAt } from "../src/scale/engine";
import { evalNode } from "../src/ycsv-formula/eval";
import { astFor } from "../src/ycsv-formula/graph";

it.skipIf(!process.env.SCALE_PROFILE)("profile incremental edit at 50k", { timeout: 600_000 }, () => {
  const doc = new Y.Doc();
  fileToDoc(buildScaleFile(50000, 10), doc);
  const engine = new SheetEngine(doc, "incremental");
  console.log("build", engine.stats);
  const cols = doc.getArray<Y.Map<unknown>>("columns").toArray();
  const aantal = String(cols.find((c) => c.get("ref") === "aantal")?.get("colId"));
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    setCellAt(doc, 1000 + i * 7000, aantal, String(77 + i));
    console.log("edit", (performance.now() - t).toFixed(2), engine.stats.lastEvaluated, engine.stats.lastChangeMs.toFixed(2));
  }
  const key = `generaal@${engine.rowIds[0]}`;
  const ast = astFor(engine.raw.get(key)!);
  const ctx: any = (engine as any).ctx;
  ctx.currentRow = engine.rowIds[0];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    evalNode(ast as any, ctx);
    console.log("SUM over 50k", (performance.now() - t).toFixed(2));
  }
});
