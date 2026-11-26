import { it } from "vitest";

declare const process: { env: Record<string, string | undefined> };
import * as Y from "yjs";
import { fileToDoc } from "../src/ycsv-model";
import { buildScaleFile } from "../src/scale/generate";
import { SheetEngine, setCellAt } from "../src/scale/engine";

it.skipIf(!process.env.SCALE_PROFILE)("split", { timeout: 600_000 }, () => {
  const doc = new Y.Doc();
  fileToDoc(buildScaleFile(50000, 10), doc);
  const cols = doc.getArray<Y.Map<unknown>>("columns").toArray();
  const aantal = String(cols.find((c) => c.get("ref") === "aantal")?.get("colId"));
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    setCellAt(doc, 1000 + i * 7000, aantal, String(77 + i));
    console.log("no-engine setCellAt", (performance.now() - t).toFixed(2));
  }
  const engine = new SheetEngine(doc, "incremental");
  const e: any = engine;
  if (process.env.NO_FAST) engine.fastAggregates = false;
  const orig = e.propagate.bind(e);
  e.propagate = (seeds: any) => { const t = performance.now(); const n = orig(seeds); console.log("propagate", (performance.now() - t).toFixed(2), n); return n; };
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    setCellAt(doc, 1000 + i * 7000, aantal, String(97 + i));
    console.log("edit total", (performance.now() - t).toFixed(2), "handler", engine.stats.lastChangeMs.toFixed(2));
  }
});
