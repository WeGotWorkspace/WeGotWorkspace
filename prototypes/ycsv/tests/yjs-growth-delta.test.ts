import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyDocOp, docView, seedDocs } from "../src/yjs-growth/docs-raw";
import { runSoloScript } from "../src/yjs-growth/docs-script";

/**
 * Spike 10: what does an incremental save cost? `encodeStateAsUpdate(doc, sv)`
 * always carries the doc's *whole* delete set, so a "diff since the server's
 * state vector" grows with history. The `update` events of the edits
 * themselves (merged with `mergeUpdates`) carry only their own deletions.
 */
describe("spike 10: incremental save size", () => {
  it("event-based deltas stay small; state-vector diffs grow with the delete set", () => {
    const doc = new Y.Doc();
    doc.clientID = 1;
    const rows: { day: number; svDiff: number; events: number }[] = [];
    let pending: Uint8Array[] = [];
    let sv = Y.encodeStateVector(doc);
    let sinceSave = 0;
    let svDiff = 0;
    let events = 0;
    let saves = 0;
    doc.on("update", (u: Uint8Array) => pending.push(u));
    runSoloScript(
      { seed: 11, blocks: 60, days: 126, actionsPerDay: 60, checkpointEvery: 63 },
      {
        seed: (b) => seedDocs(doc, b),
        newSession: (id) => {
          doc.clientID = id;
        },
        view: () => docView(doc),
        apply: (op) => {
          applyDocOp(doc, op);
          sinceSave += 1;
          if (sinceSave < 5) return;
          // A save every 5 actions.
          svDiff += Y.encodeStateAsUpdate(doc, sv).byteLength;
          events += Y.mergeUpdates(pending).byteLength;
          pending = [];
          sv = Y.encodeStateVector(doc);
          sinceSave = 0;
          saves += 1;
        },
        checkpoint: (day) => {
          if (saves) rows.push({ day, svDiff: Math.round(svDiff / saves), events: Math.round(events / saves) });
          svDiff = 0;
          events = 0;
          saves = 0;
        },
      },
    );
    console.table(rows);
    const last = rows.at(-1)!;
    expect(last.events).toBeLessThan(last.svDiff / 5);
  });
});
