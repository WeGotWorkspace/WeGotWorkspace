import { it } from "vitest";
import * as Y from "yjs";
import { fileToDoc } from "../src/ycsv-model";
import { buildScaleFile } from "../src/scale/generate";
import { SheetEngine } from "../src/scale/engine";
import { evaluateAll } from "../src/ycsv-formula";

declare const process: { env: Record<string, string | undefined> };

it.skipIf(!process.env.SCALE_PROFILE)("evaluateAll scaling", { timeout: 600_000 }, () => {
  for (const rows of [1000, 2000, 5000, 10000, 20000]) {
    const doc = new Y.Doc();
    fileToDoc(buildScaleFile(rows, 10), doc);
    const e = new SheetEngine(doc, "full");
    const refs = e.columns.map((c) => c.ref);
    const t: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      evaluateAll(e.raw, e.rowIds, {}, refs);
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    console.log(rows, t.map((x) => x.toFixed(1)).join(" "));
  }
});
