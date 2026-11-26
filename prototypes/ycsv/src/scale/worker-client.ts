import * as Y from "yjs";
import { fileToDoc } from "../ycsv-model";
import { setCellAt } from "./engine";
import { buildScaleFile, type ScaleWidth } from "./generate";

/**
 * Spike 4 worker experiment. The main thread keeps the Y.Doc (it owns editing and the
 * provider) and forwards every update to a worker that runs the incremental engine and
 * answers with the changed values. Measures what the main thread still pays.
 */
export type WorkerConfig = { rows: number; cols: ScaleWidth; edits?: number };

type Ready = { kind: "ready"; buildMs: number; keys: string[]; values: unknown[] };
type Delta = { kind: "delta"; id: number; workerMs: number; keys: string[]; values: unknown[] };

export async function runWorker(config: WorkerConfig): Promise<Record<string, number | number[] | string>> {
  const doc = new Y.Doc();
  fileToDoc(buildScaleFile(config.rows, config.cols), doc);
  const state = Y.encodeStateAsUpdate(doc);
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const values = new Map<string, unknown>();
  const out: Record<string, number | number[] | string> = { rows: config.rows, cols: config.cols };

  let t = performance.now();
  const ready = await new Promise<{ data: Ready; receiveMs: number }>((resolve) => {
    worker.onmessage = (event: MessageEvent<Ready>) => {
      const s = performance.now();
      const data = event.data; // structured-clone deserialization happens here
      for (let i = 0; i < data.keys.length; i += 1) values.set(data.keys[i] as string, data.values[i]);
      resolve({ data, receiveMs: performance.now() - s });
    };
    worker.postMessage({ kind: "init", state });
  });
  out.initWallMs = performance.now() - t;
  out.initWorkerBuildMs = ready.data.buildMs;
  out.initMainReceiveMs = ready.receiveMs;
  out.formulaValues = ready.data.keys.length;

  const colId = String(
    doc
      .getArray<Y.Map<unknown>>("columns")
      .toArray()
      .find((column) => column.get("ref") === "aantal")
      ?.get("colId"),
  );
  const tariefId = String(
    doc
      .getArray<Y.Map<unknown>>("columns")
      .toArray()
      .find((column) => column.get("ref") === "tarief")
      ?.get("colId"),
  );
  const rowCount = doc.getArray("rows").length;
  let nextId = 0;
  let pending: ((delta: Delta, receiveMs: number) => void) | null = null;
  worker.onmessage = (event: MessageEvent<Delta>) => {
    const s = performance.now();
    const data = event.data;
    for (let i = 0; i < data.keys.length; i += 1) values.set(data.keys[i] as string, data.values[i]);
    pending?.(data, performance.now() - s);
  };
  doc.on("update", (update: Uint8Array) => worker.postMessage({ kind: "update", update, id: nextId++ }));

  const roundtrip = async (mutate: () => void) => {
    const started = performance.now();
    const result = new Promise<{ delta: Delta; receiveMs: number }>((resolve) => {
      pending = (delta, receiveMs) => resolve({ delta, receiveMs });
    });
    mutate();
    const mainSync = performance.now() - started;
    const { delta, receiveMs } = await result;
    return { wall: performance.now() - started, mainSync, receiveMs, workerMs: delta.workerMs, changed: delta.keys.length };
  };

  const collect = async (label: string, n: number, mutate: (i: number) => void) => {
    const wall: number[] = [];
    const main: number[] = [];
    const worker: number[] = [];
    let changed = 0;
    for (let i = 0; i < n; i += 1) {
      const r = await roundtrip(() => mutate(i));
      wall.push(r.wall);
      main.push(r.mainSync + r.receiveMs);
      worker.push(r.workerMs);
      changed = r.changed;
    }
    out[`${label}WallMs`] = wall;
    out[`${label}MainMs`] = main;
    out[`${label}WorkerMs`] = worker;
    out[`${label}Changed`] = changed;
  };

  await collect("editTypical", config.edits ?? 20, (i) =>
    setCellAt(doc, Math.floor(((i * 37) % 20 + 0.5) * (rowCount / 20)), colId, String(2000 + i)),
  );
  await collect("editWorst", 5, (i) => setCellAt(doc, 0, tariefId, String(0.3 + i / 1000)));
  worker.terminate();
  doc.destroy();
  t = performance.now() - t;
  out.totalMs = t;
  return out;
}
