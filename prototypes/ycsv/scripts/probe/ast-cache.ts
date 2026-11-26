// Probe: AST cache behaviour of evaluateAll on the spike 4 fixture.
import * as Y from "yjs";
import { fileToDoc } from "../../src/ycsv-model";
import { buildScaleFile } from "../../src/scale/generate";
import { SheetEngine } from "../../src/scale/engine";
import { evaluateAll } from "../../src/ycsv-formula";
import { astCacheStats, resetAstCache } from "../../src/ycsv-formula/graph";

for (const notation of ["absolute", "current"] as const) {
  for (const rows of [1000, 3000, 4000, 5000]) {
    const doc = new Y.Doc();
    fileToDoc(buildScaleFile(rows, 10, notation), doc);
    const e = new SheetEngine(doc, "full");
    const refs = e.columns.map((c) => c.ref);
    resetAstCache();
    evaluateAll(e.raw, e.rowIds, {}, refs);
    const first = astCacheStats().misses;
    const s = performance.now();
    for (let i = 0; i < 3; i++) evaluateAll(e.raw, e.rowIds, {}, refs);
    const ms = (performance.now() - s) / 3;
    console.log(notation, rows, "misses first pass", first, "misses per later pass", (astCacheStats().misses - first) / 3, "ms/pass", ms.toFixed(1));
  }
}
