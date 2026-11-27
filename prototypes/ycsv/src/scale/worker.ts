import * as Y from "yjs";
import { SheetEngine } from "./engine";

/** Spike 4: the incremental engine in a Web Worker, fed with Yjs updates. */
type In = { kind: "init"; state: Uint8Array } | { kind: "update"; update: Uint8Array; id: number };

const doc = new Y.Doc();
let engine: SheetEngine | null = null;

self.onmessage = (event: MessageEvent<In>) => {
  const message = event.data;
  if (message.kind === "init") {
    const started = performance.now();
    Y.applyUpdate(doc, message.state, "remote");
    engine = new SheetEngine(doc, "incremental");
    engine.trackDirty = true;
    const buildMs = performance.now() - started;
    // All formula values once, so the main thread can paint without evaluating.
    const keys: string[] = [];
    const values: unknown[] = [];
    for (const [key, text] of engine.raw) {
      if (!text.startsWith("=")) continue;
      keys.push(key);
      values.push(engine.getValue(key));
    }
    self.postMessage({ kind: "ready", buildMs, keys, values });
    return;
  }
  if (!engine) return;
  const started = performance.now();
  Y.applyUpdate(doc, message.update, "remote");
  const keys = engine.lastDirtyKeys;
  const values = keys.map((key) => engine?.getValue(key));
  self.postMessage({ kind: "delta", id: message.id, workerMs: performance.now() - started, keys, values });
};
