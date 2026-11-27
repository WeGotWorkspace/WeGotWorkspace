import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import * as Y from "yjs";
import { applyDocOp, docView, docsShape, seedDocs } from "../src/yjs-growth/docs-raw";
import { runSoloScript } from "../src/yjs-growth/docs-script";
import { runDocsSim } from "../src/yjs-growth/docs-sim";
import { compact } from "../src/yjs-growth/epoch";
import { kib, sizes } from "../src/yjs-growth/measure";
import { LOG_MIX, SHEET_MIX, type SheetAction, runSheetSim } from "../src/yjs-growth/sheet-sim";

/**
 * Spike 10 growth runs. Opt-in (minutes, not seconds):
 *   RUN_GROWTH=1 pnpm exec vitest run tests/yjs-growth-bench.test.ts --pool=forks
 * Writes results/growth-*.json. The real-editor Docs run lives in
 * packages/apps (spike-yjs-growth.test.ts) and writes results/growth-docs-real-*.json.
 */
const RUN = process.env.RUN_GROWTH === "1";
const DAYS = Number(process.env.GROWTH_DAYS ?? 260);
const out = (name: string, data: unknown) => writeFileSync(new URL(`../results/${name}.json`, import.meta.url), JSON.stringify(data, null, 1));

describe.skipIf(!RUN)("spike 10: sidecar growth", () => {
  for (const [profile, mix] of [
    [{ name: "tracker", rows: 500, cols: 8, users: 4, actionsPerDay: 120, offlineUser: true }, SHEET_MIX],
    [{ name: "log", rows: 1000, cols: 10, users: 4, actionsPerDay: 200, offlineUser: true }, LOG_MIX],
  ] as const) {
    it(`sheets ${profile.name}`, () => {
      const started = performance.now();
      const cps = runSheetSim(profile, { days: DAYS, seed: 7, checkpointEvery: 21, mix });
      for (const c of cps) console.log(profile.name, c.day, c.rows, kib(c.textBytes), kib(c.sidecar.v1), kib(c.sidecar.v2gz), kib(c.compacted.v1), kib(c.compacted.v2gz));
      out(`growth-sheets-${profile.name}`, { profile, ms: Math.round(performance.now() - started), checkpoints: cps });
    }, 3_600_000);
  }

  it("docs raw model, multi-user vs solo (concurrency effect)", () => {
    const multi = runDocsSim({ name: "living-doc", blocks: 60, users: 4, actionsPerDay: 60, offlineUser: true }, { days: DAYS, seed: 11, checkpointEvery: 21 });
    const solo: unknown[] = [];
    const doc = new Y.Doc();
    doc.clientID = 1;
    runSoloScript(
      { seed: 11, blocks: 60, days: DAYS, actionsPerDay: 60, checkpointEvery: 21 },
      {
        seed: (b) => seedDocs(doc, b),
        newSession: (id) => {
          doc.clientID = id;
        },
        view: () => docView(doc),
        apply: (op) => applyDocOp(doc, op),
        checkpoint: (day, actions) => {
          solo.push({ day, actions, textBytes: docsShape.text(doc).length, sidecar: sizes(doc), compacted: sizes(compact(docsShape, doc).doc) });
        },
      },
    );
    out("growth-docs-raw", { multi, solo });
  }, 3_600_000);

  it("sheets: bytes per action, by action type", () => {
    const rows: unknown[] = [];
    const actions: SheetAction[] = ["retype", "typo-fix", "formula", "insert-row", "delete-row", "move-rows", "sort", "paste-block", "clear-range", "column-op"];
    for (const action of actions) {
      const n = action === "sort" ? 20 : 400;
      const cps = runSheetSim({ name: action, rows: 1000, cols: 10, users: 1, actionsPerDay: n, offlineUser: false }, { days: 1, seed: 3, checkpointEvery: 1, mix: [[1, action]] });
      const end = cps.at(-1)!;
      const start = cps[0]!;
      rows.push({
        action,
        actions: end.actions,
        perAction: {
          v1: (end.sidecar.v1 - start.sidecar.v1) / end.actions,
          v2gz: (end.sidecar.v2gz - start.sidecar.v2gz) / end.actions,
          liveV1: (end.compacted.v1 - start.compacted.v1) / end.actions,
          historyV1: (end.sidecar.v1 - end.compacted.v1 - (start.sidecar.v1 - start.compacted.v1)) / end.actions,
        },
      });
    }
    console.table(rows.map((r: any) => ({ action: r.action, n: r.actions, v1: r.perAction.v1.toFixed(1), v2gz: r.perAction.v2gz.toFixed(1), live: r.perAction.liveV1.toFixed(1), history: r.perAction.historyV1.toFixed(1) })));
    out("growth-sheets-per-action", rows);
  }, 3_600_000);
});
