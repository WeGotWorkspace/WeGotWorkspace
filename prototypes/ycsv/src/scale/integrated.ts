import * as Y from "yjs";
import { createSheetUndoManager } from "../sheets-core/collab";
import { WorkbookEngine } from "../sheets-core/engine/engine";
import { createValueSource, WorkerValues, type EngineMode, type ValueSource } from "../sheets-core/engine/host";
import { deleteRows, docToText, insertRows, parseBook, bookToDoc, sheetIds, SheetView, Workbook, writeCells } from "../sheets-core/model";
import { serialize } from "../ycsv-core/serialize";
import { buildScaleFile, type ScaleWidth } from "./generate";
import type { Host, RunResult } from "./harness";

/**
 * Integration slice: spike 4's `runScale` steps against the integrated stack — workbook
 * layout (order arrays, multi-sheet root), WorkbookEngine (main thread or worker replica)
 * and the merged SheetGrid (spikes 6+7+8). Same file, same steps, same timing rules
 * (mutation → grid render → next frame), so the numbers compare with `win-incr`.
 *
 * Worker mode: an edit counts until the worker's delta has arrived and the grid has
 * painted the new formula values, not just the literal.
 */
export type IntegratedVariant = "int-main" | "int-worker";
export type IntegratedConfig = { rows: number; cols: ScaleWidth; variant: IntegratedVariant; stepBudgetMs?: number };

export type IntegratedView = { kind: "integrated"; book: Workbook; values: ValueSource; undo: Y.UndoManager; sheetId: string };

const now = () => performance.now();

function heapMB(): number | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  gc?.();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 1048576 : null;
}

function afterFrame(): Promise<void> {
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

async function sample(label: string, out: Record<string, number[]>, budgetMs: number, max: number, once: (i: number) => Promise<number> | number) {
  const samples: number[] = [];
  out[label] = samples;
  const started = now();
  for (let i = 0; i < max; i += 1) {
    samples.push(await once(i));
    if (samples.length >= 3 && now() - started > budgetMs) break;
  }
}

export async function runIntegrated(config: IntegratedConfig, host: Omit<Host, "mount"> & { mount: (view: IntegratedView | null) => Promise<void> }): Promise<RunResult> {
  const budget = config.stepBudgetMs ?? 15_000;
  const mode: EngineMode = config.variant === "int-worker" ? "worker" : "main";
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

  // ---- import path: text → parseBook → bookToDoc → state bytes
  let text: string | null = serialize(buildScaleFile(config.rows, config.cols, "absolute"));
  scalars.fileBytes = text.length;
  let t = now();
  let parsed: ReturnType<typeof parseBook> | null = parseBook(text);
  scalars.parseMs = now() - t;
  text = null;
  let importDoc: Y.Doc | null = new Y.Doc();
  t = now();
  bookToDoc(parsed, importDoc);
  scalars.fileToDocMs = now() - t;
  parsed = null;
  t = now();
  let state: Uint8Array | null = Y.encodeStateAsUpdate(importDoc);
  scalars.encodeMs = now() - t;
  scalars.yjsBytes = state.byteLength;
  scalars.yjsBytesV2 = Y.encodeStateAsUpdateV2(importDoc).byteLength;
  importDoc.destroy();
  importDoc = null;

  // ---- open path: Yjs state → applyUpdate → engine → first paint
  const doc = new Y.Doc();
  t = now();
  Y.applyUpdate(doc, state);
  scalars.applyUpdateMs = now() - t;
  state = null;
  const sheetId = sheetIds(doc)[0]!;
  const sheet = { doc, id: sheetId };
  const book = new Workbook(doc);
  const view = new SheetView(doc, sheetId);
  const rowIds = () => view.rowIds;
  const colByRef = new Map(view.columns.map((c) => [c.ref, c.colId]));
  const rowCount = rowIds().length;

  t = now();
  const values = createValueSource(doc, mode);
  await values.ready;
  scalars.engineBuildMs = now() - t;
  if (values instanceof WorkerValues) scalars.workerBuildMs = values.buildMs;
  const undo = createSheetUndoManager(doc);

  await step("mount", async () => {
    const started = now();
    await withTimeout(host.mount({ kind: "integrated", book, values, undo, sheetId }), 120_000, "mount");
    await afterFrame();
    scalars.mountToPaintMs = now() - started;
    scalars.openToPaintMs = (scalars.applyUpdateMs as number) + (scalars.engineBuildMs as number) + (now() - started);
    scalars.domNodes = document.getElementsByTagName("*").length;
  });
  scalars.heapLoadedMB = heapMB();

  // ---- full recompute alone (a fresh engine over the loaded doc), the evaluateAll analogue
  await step("evaluateAll", async () => {
    await sample("evaluateAllMs", samples, budget, 5, () => {
      const s = now();
      new WorkbookEngine(doc).destroy();
      return now() - s;
    });
  });

  await step("serialize", async () => {
    await sample("docToFileSerializeMs", samples, budget / 2, 5, () => {
      const s = now();
      scalars.savedFileBytes = docToText(doc).length;
      return now() - s;
    });
  });

  let computeLabel = "";
  const timedUpdate = async (mutate: () => void): Promise<number> => {
    const rendered = host.nextRender();
    const started = now();
    mutate();
    const sync = now() - started;
    if (computeLabel) (samples[computeLabel] ??= []).push(sync);
    if (values instanceof WorkerValues) {
      await withTimeout(values.settled(), 60_000, "worker delta");
      // The delta has been applied and the grid notified (React renders it in a microtask);
      // the next frame paints it. Time to values = mutation → delta applied on the main thread.
      if (computeLabel) {
        const base = computeLabel.replace("SyncMs", "");
        (samples[`${base}ValuesMs`] ??= []).push(now() - started);
        (samples[`${base}WorkerMs`] ??= []).push(values.last.workerMs);
      }
    } else {
      await withTimeout(rendered, 60_000, "render after mutation");
    }
    await afterFrame();
    return now() - started;
  };
  const set = (r: number, ref: string, value: string) => writeCells(sheet, [{ rowId: rowIds()[r]!, colId: colByRef.get(ref)!, value }]);
  const bytes: number[] = [];
  const onUpdate = (update: Uint8Array) => bytes.push(update.byteLength);

  await step("editTypical", async () => {
    doc.on("update", onUpdate);
    computeLabel = "editTypicalSyncMs";
    await sample("editTypicalMs", samples, budget, 30, (i) => timedUpdate(() => set(Math.floor((((i * 37) % 30) + 0.5) * (rowCount / 30)), "aantal", String(1000 + i))));
    doc.off("update", onUpdate);
    samples.editUpdateBytes = bytes.slice();
  });

  await step("editWorst", async () => {
    computeLabel = "editWorstSyncMs";
    await sample("editWorstMs", samples, budget, 10, (i) => timedUpdate(() => set(0, "tarief", String(0.2 + i / 1000))));
  });

  await step("insertDelete", async () => {
    const mid = Math.floor(rowCount / 2);
    const insert: number[] = [];
    const remove: number[] = [];
    samples.insertRowMs = insert;
    samples.deleteRowMs = remove;
    const started = now();
    for (let i = 0; i < 10; i += 1) {
      computeLabel = "insertRowSyncMs";
      insert.push(await timedUpdate(() => insertRows(sheet, mid + 1, 1)));
      computeLabel = "deleteRowSyncMs";
      remove.push(await timedUpdate(() => deleteRows(sheet, [mid + 1])));
      if (insert.length >= 3 && now() - started > budget) break;
    }
  });

  await step("paste", async () => {
    const target = ["aantal", "prijs", "korting"].map((ref) => colByRef.get(ref)!);
    computeLabel = "paste1000SyncMs";
    await sample("paste1000Ms", samples, budget, 5, (i) =>
      timedUpdate(() => {
        const start = Math.min(rowCount - 334, Math.floor((i / 5) * rowCount));
        const ids = rowIds();
        const writes = [];
        for (let r = 0; r < 334; r += 1) {
          const rowId = ids[start + r]!;
          writes.push({ rowId, colId: target[0]!, value: String(r % 50) });
          writes.push({ rowId, colId: target[1]!, value: (r % 97).toFixed(2) });
          writes.push({ rowId, colId: target[2]!, value: String(0.1 + i / 100) });
        }
        writeCells(sheet, writes);
      }),
    );
  });

  computeLabel = "";
  await step("scroll", async () => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="grid"]');
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
      // not supported
    }
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
  values.destroy();
  undo.destroy();
  view.destroy();
  book.destroy();
  doc.destroy();
  return { config: config as unknown as RunResult["config"], scalars, samples, errors };
}
