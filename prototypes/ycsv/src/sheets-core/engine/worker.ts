import * as Y from "yjs";
import { WorkbookEngine } from "./engine";
import type { WorkerDelta, WorkerIn, WorkerReady } from "./host";

/** The engine on a replica Y.Doc. Answers every update with the values it changed. */
const doc = new Y.Doc();
let engine: WorkbookEngine | null = null;

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data;
  if (message.kind === "init") {
    const started = performance.now();
    Y.applyUpdate(doc, message.state, "remote");
    engine = new WorkbookEngine(doc);
    engine.trackDirty = true;
    const buildMs = performance.now() - started;
    // Formula values once, so the main thread can paint without evaluating.
    const keys: string[] = [];
    const values: WorkerReady["values"] = [];
    for (const [key, text] of engine.raw) {
      if (text.charCodeAt(0) !== 61) continue;
      keys.push(key);
      values.push(engine.getValue(key) ?? "");
    }
    self.postMessage({ kind: "ready", buildMs, keys, values } satisfies WorkerReady);
    return;
  }
  if (!engine) return;
  const started = performance.now();
  engine.lastDirtyKeys = [];
  Y.applyUpdate(doc, message.update, "remote");
  const keys = engine.lastDirtyKeys;
  const values = keys.map((key) => engine?.getValue(key) ?? "");
  self.postMessage({ kind: "delta", id: message.id, workerMs: performance.now() - started, evaluated: keys.length, keys, values } satisfies WorkerDelta);
};
