import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { evaluateAll } from "../ycsv-formula";
import { docToFile, fileToDoc, insertRowAfter, setCell } from "../ycsv-model";
import { SheetEngine, deleteRowAt, pasteBlock, setCellAt, type EngineMode } from "./engine";
import { buildScaleFile, type Notation, type ScaleWidth } from "./generate";

/** Browser side of `pnpm measure`. One call = one fresh page = one run of one configuration. */
export type Variant = "baseline" | "win-full" | "win-incr";

export type RunConfig = {
  rows: number;
  cols: ScaleWidth;
  variant: Variant;
  notation?: Notation;
  /** Wall budget per sampled step; sampling stops early once spent (min 3 samples). */
  stepBudgetMs?: number;
  /** Skip DOM-heavy steps (mount etc.) when true; data-model steps still run. */
  modelOnly?: boolean;
};

export type View =
  | { kind: "baseline"; doc: Y.Doc }
  | { kind: "windowed"; engine: SheetEngine }
  | null;

export type Host = {
  /** Render `view`; resolves after its first layout effect. */
  mount: (view: View) => Promise<void>;
  /** Resolves on the next grid render signal (layout effect, baseline: layout + rAF). */
  nextRender: () => Promise<void>;
};

export type RunResult = {
  config: RunConfig;
  scalars: Record<string, number | string | null>;
  samples: Record<string, number[]>;
  errors: string[];
};

const now = () => performance.now();

function heapMB(): number | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  gc?.();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 1048576 : null;
}

function afterFrame(): Promise<void> {
  // rAF runs in the frame's rendering steps; the message task after it runs once that
  // frame has been produced. That is the "paint" end of every *→paint number here.
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function colIds(doc: Y.Doc): Map<string, string> {
  const out = new Map<string, string>();
  for (const map of doc.getArray<Y.Map<unknown>>("columns").toArray()) {
    out.set(String(map.get("ref")), String(map.get("colId")));
  }
  return out;
}

async function sample(
  label: string,
  out: Record<string, number[]>,
  budgetMs: number,
  max: number,
  once: (i: number) => Promise<number> | number,
): Promise<void> {
  const samples: number[] = [];
  out[label] = samples;
  const started = now();
  for (let i = 0; i < max; i += 1) {
    samples.push(await once(i));
    if (samples.length >= 3 && now() - started > budgetMs) break;
  }
}

export async function runScale(config: RunConfig, host: Host): Promise<RunResult> {
  const budget = config.stepBudgetMs ?? 15_000;
  const scalars: RunResult["scalars"] = {};
  const samples: RunResult["samples"] = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  scalars.heapStartMB = heapMB();

  // ---- import path: text → parse → fileToDoc (the old/first doc) → state bytes
  let text: string | null = serialize(buildScaleFile(config.rows, config.cols, config.notation ?? "absolute"));
  scalars.fileBytes = text.length;
  let t = now();
  let file: ReturnType<typeof parse> | null = parse(text);
  scalars.parseMs = now() - t;
  text = null;

  let importDoc: Y.Doc | null = new Y.Doc();
  t = now();
  fileToDoc(file, importDoc);
  scalars.fileToDocMs = now() - t;
  file = null;

  t = now();
  let state: Uint8Array | null = Y.encodeStateAsUpdate(importDoc);
  scalars.encodeMs = now() - t;
  scalars.yjsBytes = state.byteLength;
  scalars.yjsBytesV2 = Y.encodeStateAsUpdateV2(importDoc).byteLength;

  // Mutation cost without any observer: current `mutate.setCell` vs index-based `setCellAt`.
  {
    const ids = colIds(importDoc);
    const aantal = ids.get("aantal") ?? "";
    const rowIds = importDoc
      .getArray<Y.Map<unknown>>("rows")
      .toArray()
      .map((row) => String(row.get("rowId")));
    const d = importDoc;
    await sample("mutateSetCellMs", samples, budget / 3, 10, (i) => {
      const s = now();
      setCell(d, rowIds[Math.floor((i + 0.5) * (rowIds.length / 10))] ?? "", aantal, String(500 + i));
      return now() - s;
    });
    await sample("mutateSetCellAtMs", samples, budget / 3, 10, (i) => {
      const s = now();
      setCellAt(d, Math.floor((i + 0.5) * (rowIds.length / 10)), aantal, String(700 + i));
      return now() - s;
    });
  }
  importDoc.destroy();
  importDoc = null;

  // ---- open path: Yjs state → applyUpdate → engine → first paint (what a client does on load)
  const doc = new Y.Doc();
  t = now();
  Y.applyUpdate(doc, state);
  scalars.applyUpdateMs = now() - t;
  state = null;
  const ids = colIds(doc);
  const rowCount = doc.getArray("rows").length;

  let engine: SheetEngine | null = null;
  if (config.variant !== "baseline") {
    t = now();
    engine = new SheetEngine(doc, config.variant === "win-incr" ? "incremental" : ("full" satisfies EngineMode));
    scalars.engineBuildMs = now() - t;
    scalars.engineReadMs = engine.stats.readMs;
    scalars.engineGraphMs = engine.stats.graphMs;
    scalars.engineEvalMs = engine.stats.evalMs;
  }

  if (!config.modelOnly) {
    await step("mount", async () => {
      const started = now();
      const view: View = engine ? { kind: "windowed", engine } : { kind: "baseline", doc };
      await withTimeout(host.mount(view), 120_000, "mount");
      await afterFrame();
      scalars.mountToPaintMs = now() - started;
      scalars.openToPaintMs =
        (scalars.applyUpdateMs as number) + ((scalars.engineBuildMs as number | undefined) ?? 0) + (now() - started);
      scalars.domNodes = document.getElementsByTagName("*").length;
    });
  }
  scalars.heapLoadedMB = heapMB();

  // ---- evaluateAll alone (the full-recompute cost), on the loaded model
  await step("evaluateAll", async () => {
    const model = engine ?? new SheetEngine(doc, "full");
    await sample("evaluateAllMs", samples, budget, 10, () => {
      const s = now();
      evaluateAll(model.raw, model.rowIds, {}, model.columns.map((column) => column.ref));
      return now() - s;
    });
    if (!engine) model.destroy();
  });

  // ---- save path: the client serializes the whole file next to the Yjs state on every save
  await step("serialize", async () => {
    await sample("docToFileSerializeMs", samples, budget / 2, 5, () => {
      const s = now();
      const out = serialize(docToFile(doc));
      scalars.savedFileBytes = out.length;
      return now() - s;
    });
  });

  if (config.modelOnly) {
    engine?.destroy();
    doc.destroy();
    return { config, scalars, samples, errors };
  }

  // Sync part (mutation + Yjs observers + engine recompute), recorded per interaction label.
  let computeLabel = "";
  const timedUpdate = async (mutate: () => void): Promise<number> => {
    const rendered = host.nextRender();
    const started = now();
    mutate();
    const sync = now() - started;
    if (computeLabel) (samples[computeLabel] ??= []).push(sync);
    await withTimeout(rendered, 60_000, "render after mutation");
    await afterFrame();
    return now() - started;
  };

  const aantal = ids.get("aantal") ?? "";
  const tarief = ids.get("tarief") ?? "";
  const bytes: number[] = [];
  const onUpdate = (update: Uint8Array) => bytes.push(update.byteLength);

  await step("editTypical", async () => {
    doc.on("update", onUpdate);
    computeLabel = "editTypicalSyncMs";
    await sample("editTypicalMs", samples, budget, 30, (i) =>
      timedUpdate(() => setCellAt(doc, Math.floor(((i * 37) % 30 + 0.5) * (rowCount / 30)), aantal, String(1000 + i))),
    );
    doc.off("update", onUpdate);
    samples.editUpdateBytes = bytes.slice();
    if (engine) scalars.editTypicalEvaluated = engine.stats.lastEvaluated;
  });

  await step("editWorst", async () => {
    computeLabel = "editWorstSyncMs";
    await sample("editWorstMs", samples, budget, 10, (i) =>
      timedUpdate(() => setCellAt(doc, 0, tarief, String(0.2 + i / 1000))),
    );
    if (engine) scalars.editWorstEvaluated = engine.stats.lastEvaluated;
  });

  await step("insertDelete", async () => {
    const mid = Math.floor(rowCount / 2);
    computeLabel = "";
    const insert: number[] = [];
    const remove: number[] = [];
    samples.insertRowMs = insert;
    samples.deleteRowMs = remove;
    const started = now();
    for (let i = 0; i < 10; i += 1) {
      computeLabel = "insertRowSyncMs";
      insert.push(await timedUpdate(() => insertRowAfter(doc, mid)));
      computeLabel = "deleteRowSyncMs";
      remove.push(await timedUpdate(() => deleteRowAt(doc, mid + 1)));
      if (insert.length >= 3 && now() - started > budget) break;
    }
  });

  await step("paste", async () => {
    const block = Array.from({ length: 334 }, (_, r) => [String(r % 50), (r % 97).toFixed(2), "0.1"]);
    computeLabel = "paste1000SyncMs";
    const target = [ids.get("aantal") ?? "", ids.get("prijs") ?? "", ids.get("korting") ?? ""];
    await sample("paste1000Ms", samples, budget, 5, (i) =>
      timedUpdate(() =>
        pasteBlock(
          doc,
          Math.min(rowCount - 334, Math.floor((i / 5) * rowCount)),
          target,
          block.map((row) => row.map((cell) => (cell === "0.1" ? String(0.1 + i / 100) : cell))),
        ),
      ),
    );
    if (engine) scalars.pasteEvaluated = engine.stats.lastEvaluated;
  });

  computeLabel = "";
  await step("scroll", async () => {
    const scroller = document.querySelector<HTMLElement>("[data-scroller]");
    if (!scroller) throw new Error("no scroller");
    scroller.scrollTop = 0;
    await afterFrame();
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    try {
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      // longtask not supported
    }
    // 2 s of flinging: 3 rows (84 px) per frame, wrapping at the end.
    const frames: number[] = [];
    await new Promise<void>((resolve) => {
      let last = 0;
      let count = 0;
      const started = now();
      const tick = (time: number) => {
        if (last) frames.push(time - last);
        last = time;
        count += 1;
        const max = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = scroller.scrollTop + 84 > max ? 0 : scroller.scrollTop + 84;
        if (count < 120 && now() - started < 20_000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    await afterFrame();
    observer.disconnect();
    samples.scrollFrameMs = frames;
    const total = frames.reduce((sum, frame) => sum + frame, 0);
    scalars.scrollFps = frames.length > 0 ? (1000 * frames.length) / total : null;
    scalars.scrollFramesOver50ms = frames.filter((frame) => frame > 50).length;
    scalars.scrollLongTasks = longTasks.length;
    scalars.scrollLongTaskMs = longTasks.reduce((sum, value) => sum + value, 0);
  });

  scalars.heapEndMB = heapMB();
  await host.mount(null);
  engine?.destroy();
  doc.destroy();
  return { config, scalars, samples, errors };
}
