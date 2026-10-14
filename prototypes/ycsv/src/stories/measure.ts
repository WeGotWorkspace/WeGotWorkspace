import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { buildLargeFile } from "./large-sheet";
import { evaluateAll, type RawCells } from "../ycsv-formula";
import { astCacheStats, resetAstCache } from "../ycsv-formula/graph";
import { formatCacheStats } from "../ycsv-grid/format";
import { docToFile, fileToDoc } from "../ycsv-model";
import { deleteRow, insertRowAfter, setCell } from "../ycsv-model/mutate";

export type HeapMarks = {
  beforeLoad: number | null;
  afterLoad: number | null;
};

type Model = {
  raw: RawCells;
  rowOrder: string[];
  defs: Record<string, unknown>;
  aantalColId: string;
  rowIds: string[];
};

type Summary = { median: number; p95: number; max: number };

const PAINT_TIMEOUT_MS = 30_000;

function heapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

function summarize(samples: number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  const p95 = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] ?? 0;
  return { median, p95, max: sorted[sorted.length - 1] ?? 0 };
}

function readModel(doc: Y.Doc): Model {
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  const rowMaps = doc.getArray<Y.Map<unknown>>("rows");
  const raw: RawCells = new Map();
  const rowIds: string[] = [];
  const refs: string[] = [];
  const colIds: string[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    refs.push(String(columns.get(i).get("ref") ?? ""));
    colIds.push(String(columns.get(i).get("colId") ?? ""));
  }
  for (let i = 0; i < rowMaps.length; i += 1) {
    const row = rowMaps.get(i);
    const rowId = String(row.get("rowId") ?? "");
    rowIds.push(rowId);
    const cells = row.get("cells") as Y.Map<string>;
    for (let c = 0; c < columns.length; c += 1) {
      raw.set(`${refs[c]}@${rowId}`, cells.get(colIds[c] ?? "") ?? "");
    }
  }
  const defsValue = doc.getMap("raw").get("defs");
  const defs = defsValue && typeof defsValue === "object" ? (defsValue as Record<string, unknown>) : {};
  return {
    raw,
    rowOrder: rowIds,
    defs,
    aantalColId: colIds[refs.indexOf("aantal")] ?? "",
    rowIds,
  };
}

function armPaint(): Promise<number> {
  performance.clearMarks("commit");
  performance.clearMeasures("commit→paint");
  performance.mark("commit");
  const host = window as Window & { __ycsvPainted?: () => void };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      host.__ycsvPainted = undefined;
      reject(new Error("commit→paint exceeded 30000 ms"));
    }, PAINT_TIMEOUT_MS);
    host.__ycsvPainted = () => {
      clearTimeout(timer);
      host.__ycsvPainted = undefined;
      const entry = performance.getEntriesByName("commit→paint").at(-1);
      performance.clearMarks("commit");
      performance.clearMeasures("commit→paint");
      resolve(entry?.duration ?? Number.NaN);
    };
  });
}

async function waitVisible(mutate: () => void): Promise<number> {
  const pending = armPaint();
  mutate();
  return pending;
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function over(value: number, threshold: number): string {
  return value > threshold ? "ja" : "nee";
}

export async function measureAll(doc: Y.Doc, text: string, heap: HeapMarks): Promise<string> {
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
  };

  const heapNow = heapBytes();
  note(`heap nu ${heapNow === null ? "n.v.t." : `${(heapNow / 1048576).toFixed(1)} MB`}`);

  const t0 = performance.now();
  const file = parse(text);
  const t1 = performance.now();
  const loaded = armPaint();
  fileToDoc(file, doc);
  const t2 = performance.now();
  await loaded;
  const parseMs = t1 - t0;
  const loadMs = t2 - t1;
  note(`M1 parse ${ms(parseMs)}`);
  note(`M1 fileToDoc ${ms(loadMs)}`);

  const freshState = Y.encodeStateAsUpdate(doc).byteLength;
  note(`M5 volledige state (vers) ${kb(freshState)}`);

  const model = readModel(doc);
  const evalSamples: number[] = [];
  for (let i = 0; i < 23; i += 1) {
    const started = performance.now();
    evaluateAll(model.raw, model.rowOrder, model.defs);
    const elapsed = performance.now() - started;
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M2 afgebroken na run ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
      return lines.join("\n");
    }
    evalSamples.push(elapsed);
  }
  const evalStats = summarize(evalSamples.slice(3));
  note(`M2 evaluateAll mediaan ${ms(evalStats.median)}`);
  note(`M2 evaluateAll p95 ${ms(evalStats.p95)}`);
  note(`M2 evaluateAll max ${ms(evalStats.max)}`);
  note("M2 graafopbouw: niet apart te meten zonder evaluateAll te splitsen");

  const sizes: number[] = [];
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") sizes.push(update.byteLength);
  };
  doc.on("update", onUpdate);
  const paintSamples: number[] = [];
  try {
    for (let i = 0; i < 50; i += 1) {
      const index = (i * 24) % model.rowIds.length;
      const rowId = model.rowIds[index];
      if (!rowId) break;
      const elapsed = await waitVisible(() => setCell(doc, rowId, model.aantalColId, String(100 + i)));
      if (elapsed > PAINT_TIMEOUT_MS) {
        note(`M3 afgebroken bij wijziging ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
        return lines.join("\n");
      }
      paintSamples.push(elapsed);
    }
  } finally {
    doc.off("update", onUpdate);
  }
  const paintStats = summarize(paintSamples);
  note(`M3 commit→paint mediaan ${ms(paintStats.median)}`);
  note(`M3 commit→paint p95 ${ms(paintStats.p95)}`);
  note(`M3 commit→paint max ${ms(paintStats.max)}`);
  const avgBytes = sizes.reduce((sum, size) => sum + size, 0) / Math.max(sizes.length, 1);
  const maxBytes = sizes.reduce((max, size) => Math.max(max, size), 0);
  note(`M4 bytes/wijziging gem. ${avgBytes.toFixed(0)} B`);
  note(`M4 bytes/wijziging max ${maxBytes} B`);
  note(`M4 samples ${sizes.length}`);

  const afterState = Y.encodeStateAsUpdate(doc).byteLength;
  note(`M5 volledige state (na 50) ${kb(afterState)}`);

  const heapAfterM3 = heapBytes();
  note(`M6 heap vóór laden ${heap.beforeLoad === null ? "n.v.t." : `${(heap.beforeLoad / 1048576).toFixed(1)} MB`}`);
  note(`M6 heap na laden ${heap.afterLoad === null ? "n.v.t." : `${(heap.afterLoad / 1048576).toFixed(1)} MB`}`);
  note(`M6 heap na M3 ${heapAfterM3 === null ? "n.v.t." : `${(heapAfterM3 / 1048576).toFixed(1)} MB`}`);

  const serialSamples: number[] = [];
  let serialBytes = 0;
  for (let i = 0; i < 10; i += 1) {
    const started = performance.now();
    const textOut = serialize(docToFile(doc));
    serialSamples.push(performance.now() - started);
    serialBytes = BufferByteLength(textOut);
  }
  const serialStats = summarize(serialSamples);
  note(`M8 serialize mediaan ${ms(serialStats.median)}`);
  note(`M8 uitvoer ${kb(serialBytes)}`);

  const insertSamples: number[] = [];
  const deleteSamples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const before = readModel(doc);
    const at = Math.min(599, before.rowIds.length - 1);
    insertSamples.push(await waitVisible(() => insertRowAfter(doc, at)));
    const inserted = readModel(doc).rowIds[Math.min(at + 1, readModel(doc).rowIds.length - 1)];
    if (inserted) await waitVisible(() => deleteRow(doc, inserted));
  }
  for (let i = 0; i < 10; i += 1) {
    const before = readModel(doc);
    const at = Math.min(599, before.rowIds.length - 1);
    const rowId = before.rowIds[at];
    if (!rowId) break;
    deleteSamples.push(await waitVisible(() => deleteRow(doc, rowId)));
    await waitVisible(() => insertRowAfter(doc, Math.max(0, at - 1)));
  }
  note(`M7 insertRow mediaan ${ms(summarize(insertSamples).median)}`);
  note(`M7 deleteRow mediaan ${ms(summarize(deleteSamples).median)}`);

  const table = [
    ["Meting", "Waarde", "Drempel", "Boven drempel?"],
    ["M1 parse", ms(parseMs), "—", "—"],
    ["M1 fileToDoc", ms(loadMs), "—", "—"],
    ["M2 evaluateAll mediaan", ms(evalStats.median), "50 ms", over(evalStats.median, 50)],
    ["M2 evaluateAll p95", ms(evalStats.p95), "50 ms", over(evalStats.p95, 50)],
    ["M3 commit→paint mediaan", ms(paintStats.median), "100 ms", over(paintStats.median, 100)],
    ["M3 commit→paint p95", ms(paintStats.p95), "100 ms", over(paintStats.p95, 100)],
    ["M4 bytes/wijziging gem.", `${avgBytes.toFixed(0)} B`, "1 KB", over(avgBytes, 1024)],
    ["M4 bytes/wijziging max", `${maxBytes} B`, "1 KB", over(maxBytes, 1024)],
    ["M5 volledige state (vers)", kb(freshState), "256 KB", over(freshState, 256 * 1024)],
    ["M5 volledige state (na 50)", kb(afterState), "256 KB", over(afterState, 256 * 1024)],
    [
      "M6 heap na laden",
      heap.afterLoad === null ? "n.v.t." : `${(heap.afterLoad / 1048576).toFixed(1)} MB`,
      "—",
      "—",
    ],
    ["M7 insertRow", ms(summarize(insertSamples).median), "100 ms", over(summarize(insertSamples).median, 100)],
    ["M7 deleteRow", ms(summarize(deleteSamples).median), "100 ms", over(summarize(deleteSamples).median, 100)],
    ["M8 serialize", ms(serialStats.median), "—", "—"],
  ];
  console.table(table.slice(1).map((row) => ({
    Meting: row[0],
    Waarde: row[1],
    Drempel: row[2],
    "Boven drempel?": row[3],
  })));
  note("");
  note(table.map((row) => row.join(" | ")).join("\n"));
  note("klaar");
  return lines.join("\n");
}

function BufferByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function cacheLine(label: string, before: { entries: number; misses: number }, after: { entries: number; misses: number }): string {
  return `${label} ${after.entries} entries, ${after.misses - before.misses} missers tijdens M3 (${after.misses} totaal)`;
}

export async function measureCached(doc: Y.Doc): Promise<string> {
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
  };
  const model = readModel(doc);
  const formulaBefore = model.raw.get(`totaal@${model.rowIds[0] ?? ""}`) ?? "";

  const evalSamples: number[] = [];
  for (let i = 0; i < 23; i += 1) {
    const started = performance.now();
    evaluateAll(model.raw, model.rowOrder, model.defs);
    const elapsed = performance.now() - started;
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M2 afgebroken na run ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
      return lines.join("\n");
    }
    evalSamples.push(elapsed);
  }
  const evalStats = summarize(evalSamples.slice(3));
  note(`M2 evaluateAll mediaan ${ms(evalStats.median)}`);
  note(`M2 evaluateAll p95 ${ms(evalStats.p95)}`);
  note(`M2 evaluateAll max ${ms(evalStats.max)}`);

  const formatBefore = formatCacheStats();
  const astBefore = astCacheStats();
  const paintSamples: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const index = (i * 24) % model.rowIds.length;
    const rowId = model.rowIds[index];
    if (!rowId) break;
    const elapsed = await waitVisible(() => setCell(doc, rowId, model.aantalColId, String(100 + i)));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M3 afgebroken bij wijziging ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
      return lines.join("\n");
    }
    paintSamples.push(elapsed);
  }
  const paintStats = summarize(paintSamples);
  note(`M3 commit→paint mediaan ${ms(paintStats.median)}`);
  note(`M3 commit→paint p95 ${ms(paintStats.p95)}`);
  note(`M3 commit→paint max ${ms(paintStats.max)}`);

  const formatAfter = formatCacheStats();
  const astAfter = astCacheStats();
  const formulaAfter = readModel(doc).raw.get(`totaal@${model.rowIds[0] ?? ""}`) ?? "";
  note(`M9 ${cacheLine("formatter-cache", formatBefore, formatAfter)}`);
  note(`M9 ${cacheLine("AST-cache", astBefore, astAfter)}`);
  note(`M9 formule totaal rij 1 gelijk: ${formulaBefore === formulaAfter ? "ja" : "nee"}`);

  const insertSamples: number[] = [];
  const deleteSamples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const before = readModel(doc);
    const at = Math.min(599, before.rowIds.length - 1);
    const elapsed = await waitVisible(() => insertRowAfter(doc, at));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M7 insert afgebroken bij run ${i + 1}: ${ms(elapsed)} bij ${before.rowIds.length} rijen`);
      return lines.join("\n");
    }
    insertSamples.push(elapsed);
    const inserted = readModel(doc).rowIds[Math.min(at + 1, readModel(doc).rowIds.length - 1)];
    if (inserted) await waitVisible(() => deleteRow(doc, inserted));
  }
  for (let i = 0; i < 10; i += 1) {
    const before = readModel(doc);
    const at = Math.min(599, before.rowIds.length - 1);
    const rowId = before.rowIds[at];
    if (!rowId) break;
    const elapsed = await waitVisible(() => deleteRow(doc, rowId));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M7 delete afgebroken bij run ${i + 1}: ${ms(elapsed)} bij ${before.rowIds.length} rijen`);
      return lines.join("\n");
    }
    deleteSamples.push(elapsed);
    await waitVisible(() => insertRowAfter(doc, Math.max(0, at - 1)));
  }
  const insertMedian = summarize(insertSamples).median;
  const deleteMedian = summarize(deleteSamples).median;
  note(`M7 insertRow mediaan ${ms(insertMedian)}`);
  note(`M7 deleteRow mediaan ${ms(deleteMedian)}`);

  const table = [
    ["Meting", "Nu", "Drempel", "Boven drempel?"],
    ["M2 evaluateAll mediaan", ms(evalStats.median), "50 ms", over(evalStats.median, 50)],
    ["M2 evaluateAll p95", ms(evalStats.p95), "50 ms", over(evalStats.p95, 50)],
    ["M2 evaluateAll max", ms(evalStats.max), "—", "—"],
    ["M3 commit→paint mediaan", ms(paintStats.median), "100 ms", over(paintStats.median, 100)],
    ["M3 commit→paint p95", ms(paintStats.p95), "100 ms", over(paintStats.p95, 100)],
    ["M3 commit→paint max", ms(paintStats.max), "—", "—"],
    ["M7 insertRow", ms(insertMedian), "100 ms", over(insertMedian, 100)],
    ["M7 deleteRow", ms(deleteMedian), "100 ms", over(deleteMedian, 100)],
    ["M9 formatter-cache", `${formatAfter.entries} entries, ${formatAfter.misses - formatBefore.misses} missers tijdens M3`, "—", "—"],
    ["M9 AST-cache", `${astAfter.entries} entries, ${astAfter.misses - astBefore.misses} missers tijdens M3`, "—", "—"],
  ];
  console.table(
    table.slice(1).map((row) => ({
      Meting: row[0],
      Nu: row[1],
      Drempel: row[2],
      "Boven drempel?": row[3],
    })),
  );
  note("");
  note(table.map((row) => row.join(" | ")).join("\n"));
  note("klaar");
  return lines.join("\n");
}

function evalMedian(rowCount: number): number {
  const doc = new Y.Doc();
  fileToDoc(parse(serialize(buildLargeFile(rowCount))), doc);
  const model = readModel(doc);
  const samples: number[] = [];
  for (let i = 0; i < 23; i += 1) {
    const started = performance.now();
    evaluateAll(model.raw, model.rowOrder, model.defs);
    const elapsed = performance.now() - started;
    if (elapsed > PAINT_TIMEOUT_MS) {
      throw new Error(`M10 afgebroken na run ${i + 1}: ${ms(elapsed)} bij ${rowCount} rijen`);
    }
    samples.push(elapsed);
  }
  return summarize(samples.slice(3)).median;
}

export async function measureIndexed(doc: Y.Doc): Promise<string> {
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
  };
  const model = readModel(doc);

  const evalSamples: number[] = [];
  for (let i = 0; i < 23; i += 1) {
    const started = performance.now();
    evaluateAll(model.raw, model.rowOrder, model.defs);
    const elapsed = performance.now() - started;
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M2 afgebroken na run ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
      return lines.join("\n");
    }
    evalSamples.push(elapsed);
  }
  const evalStats = summarize(evalSamples.slice(3));
  note(`M2 evaluateAll mediaan ${ms(evalStats.median)}`);
  note(`M2 evaluateAll p95 ${ms(evalStats.p95)}`);
  note(`M2 evaluateAll max ${ms(evalStats.max)}`);

  const paintSamples: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const index = (i * 24) % model.rowIds.length;
    const rowId = model.rowIds[index];
    if (!rowId) break;
    const elapsed = await waitVisible(() => setCell(doc, rowId, model.aantalColId, String(100 + i)));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M3 afgebroken bij wijziging ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
      return lines.join("\n");
    }
    paintSamples.push(elapsed);
  }
  const paintStats = summarize(paintSamples);
  note(`M3 commit→paint mediaan ${ms(paintStats.median)}`);
  note(`M3 commit→paint p95 ${ms(paintStats.p95)}`);
  note(`M3 commit→paint max ${ms(paintStats.max)}`);

  const serialSamples: number[] = [];
  let serialBytes = 0;
  for (let i = 0; i < 10; i += 1) {
    const started = performance.now();
    const textOut = serialize(docToFile(doc));
    const elapsed = performance.now() - started;
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M8 afgebroken bij run ${i + 1}: ${ms(elapsed)} bij ${model.rowIds.length} rijen`);
      return lines.join("\n");
    }
    serialSamples.push(elapsed);
    serialBytes = new TextEncoder().encode(textOut).length;
  }
  const serialStats = summarize(serialSamples);
  note(`M8 serialize mediaan ${ms(serialStats.median)}`);
  note(`M8 uitvoer ${kb(serialBytes)}`);

  const insertSamples: number[] = [];
  const deleteSamples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const before = readModel(doc);
    const at = Math.min(599, before.rowIds.length - 1);
    const elapsed = await waitVisible(() => insertRowAfter(doc, at));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M7 insert afgebroken bij run ${i + 1}: ${ms(elapsed)} bij ${before.rowIds.length} rijen`);
      return lines.join("\n");
    }
    insertSamples.push(elapsed);
    const inserted = readModel(doc).rowIds[Math.min(at + 1, readModel(doc).rowIds.length - 1)];
    if (inserted) await waitVisible(() => deleteRow(doc, inserted));
  }
  for (let i = 0; i < 10; i += 1) {
    const before = readModel(doc);
    const at = Math.min(599, before.rowIds.length - 1);
    const rowId = before.rowIds[at];
    if (!rowId) break;
    const elapsed = await waitVisible(() => deleteRow(doc, rowId));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M7 delete afgebroken bij run ${i + 1}: ${ms(elapsed)} bij ${before.rowIds.length} rijen`);
      return lines.join("\n");
    }
    deleteSamples.push(elapsed);
    await waitVisible(() => insertRowAfter(doc, Math.max(0, at - 1)));
  }
  const insertMedian = summarize(insertSamples).median;
  const deleteMedian = summarize(deleteSamples).median;
  note(`M7 insertRow mediaan ${ms(insertMedian)}`);
  note(`M7 deleteRow mediaan ${ms(deleteMedian)}`);

  const scaleCounts = [300, 600, 1200, 2400];
  const scale: number[] = [];
  for (const count of scaleCounts) {
    const median = evalMedian(count);
    scale.push(median);
    const previous = scale.length > 1 ? scale[scale.length - 2] : undefined;
    const factor = previous && previous > 0 ? (median / previous).toFixed(2) : "—";
    note(`M10 ${count} rijen mediaan ${ms(median)} factor ${factor}`);
  }

  const table = [
    ["Meting", "Nu", "Drempel", "Boven drempel?"],
    ["M2 evaluateAll mediaan", ms(evalStats.median), "50 ms", over(evalStats.median, 50)],
    ["M2 evaluateAll p95", ms(evalStats.p95), "50 ms", over(evalStats.p95, 50)],
    ["M2 evaluateAll max", ms(evalStats.max), "—", "—"],
    ["M3 commit→paint mediaan", ms(paintStats.median), "100 ms", over(paintStats.median, 100)],
    ["M3 commit→paint p95", ms(paintStats.p95), "100 ms", over(paintStats.p95, 100)],
    ["M3 commit→paint max", ms(paintStats.max), "—", "—"],
    ["M7 insertRow", ms(insertMedian), "100 ms", over(insertMedian, 100)],
    ["M7 deleteRow", ms(deleteMedian), "100 ms", over(deleteMedian, 100)],
    ["M8 serialize", ms(serialStats.median), "—", "—"],
    ...scaleCounts.map((count, index) => ["M10", String(count), ms(scale[index] ?? 0), ""]),
  ];
  console.table(
    table.slice(1).map((row) => ({
      Meting: row[0],
      Nu: row[1],
      Drempel: row[2],
      "Boven drempel?": row[3],
    })),
  );
  note("");
  note(table.map((row) => row.join(" | ")).join("\n"));
  note("klaar");
  return lines.join("\n");
}

function throughModel(text: string): string {
  const fresh = new Y.Doc();
  fileToDoc(parse(text), fresh);
  return serialize(docToFile(fresh));
}

function measureVariant(label: string, text: string): {
  loadMs: number;
  median: number;
  p95: number;
  max: number;
  serialMs: number;
  entries: number;
} {
  resetAstCache();
  const file = parse(text);
  const fresh = new Y.Doc();
  const started = performance.now();
  fileToDoc(file, fresh);
  const loadMs = performance.now() - started;
  const model = readModel(fresh);
  const samples: number[] = [];
  for (let i = 0; i < 23; i += 1) {
    const t = performance.now();
    evaluateAll(model.raw, model.rowOrder, model.defs);
    const elapsed = performance.now() - t;
    if (elapsed > PAINT_TIMEOUT_MS) throw new Error(`M2 ${label} afgebroken na run ${i + 1}: ${ms(elapsed)}`);
    samples.push(elapsed);
  }
  const stats = summarize(samples.slice(3));
  const entries = astCacheStats().entries;
  const serialSamples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const t = performance.now();
    serialize(docToFile(fresh));
    const elapsed = performance.now() - t;
    if (elapsed > PAINT_TIMEOUT_MS) throw new Error(`M8 ${label} afgebroken: ${ms(elapsed)}`);
    serialSamples.push(elapsed);
  }
  return { loadMs, median: stats.median, p95: stats.p95, max: stats.max, serialMs: summarize(serialSamples).median, entries };
}

export async function measureSpike2(
  doc: Y.Doc,
  texts: { A: string; B: string; C: string; D: string },
): Promise<string> {
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
  };
  const order = ["A", "B", "C", "D"] as const;
  const results = [];
  for (const label of order) {
    const result = measureVariant(label, texts[label]);
    results.push(result);
    note(
      `${label} M1 ${ms(result.loadMs)} M2 ${ms(result.median)} p95 ${ms(result.p95)} max ${ms(result.max)} M8 ${ms(result.serialMs)} M9 ${result.entries}`,
    );
    if (label === "A" && result.entries !== 3) {
      note("M9(A) is niet 3. De AST is niet rij-onafhankelijk. gestopt.");
      return lines.join("\n");
    }
  }

  const [variantA, variantB, variantC, variantD] = results;
  if (!variantA || !variantB || !variantC || !variantD) return lines.join("\n");

  const checks: [string, string, boolean][] = [
    ["serialize(parse(C)) via model", "=== B", throughModel(texts.C) === texts.B],
    ["serialize(parse(D)) via model", "=== B", throughModel(texts.D) === texts.B],
    ["serialize(parse(A)) via model", "=== A", throughModel(texts.A) === texts.A],
    ["serialize(parse(B)) via model", "=== B", throughModel(texts.B) === texts.B],
    ["serialize(parse(C)) literal", "body unchanged", serialize(parse(texts.C)) === texts.C],
    ["serialize(parse(D)) literal", "body unchanged", serialize(parse(texts.D)) === texts.D],
  ];
  for (const [label, expect, ok] of checks) note(`${label} ${expect}: ${ok ? "ja" : "nee"}`);

  const model = readModel(doc);
  const paintSamples: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const index = (i * 24) % model.rowIds.length;
    const rowId = model.rowIds[index];
    if (!rowId) break;
    const elapsed = await waitVisible(() => setCell(doc, rowId, model.aantalColId, String(100 + i)));
    if (elapsed > PAINT_TIMEOUT_MS) {
      note(`M3 afgebroken bij wijziging ${i + 1}: ${ms(elapsed)}`);
      return lines.join("\n");
    }
    paintSamples.push(elapsed);
  }
  const paint = summarize(paintSamples);
  note(`M3 commit→paint mediaan ${ms(paint.median)} p95 ${ms(paint.p95)} max ${ms(paint.max)}`);

  const scaleCounts = [300, 600, 1200, 2400];
  const scale: number[] = [];
  for (const count of scaleCounts) {
    resetAstCache();
    const fresh = new Y.Doc();
    fileToDoc(parse(serialize(buildLargeFile(count, "current"))), fresh);
    const sized = readModel(fresh);
    const samples: number[] = [];
    for (let i = 0; i < 23; i += 1) {
      const t = performance.now();
      evaluateAll(sized.raw, sized.rowOrder, sized.defs);
      const elapsed = performance.now() - t;
      if (elapsed > PAINT_TIMEOUT_MS) {
        note(`M10 afgebroken bij ${count} rijen run ${i + 1}: ${ms(elapsed)}`);
        return lines.join("\n");
      }
      samples.push(elapsed);
    }
    const median = summarize(samples.slice(3)).median;
    scale.push(median);
    const previous = scale.length > 1 ? scale[scale.length - 2] : undefined;
    const factor = previous && previous > 0 ? (median / previous).toFixed(2) : "—";
    note(`M10 ${count} ${ms(median)} factor ${factor}`);
  }

  note("klaar");
  return lines.join("\n");
}

export async function measureEdits(doc: Y.Doc): Promise<void> {
  const model = readModel(doc);
  for (let i = 0; i < 50; i += 1) {
    const index = (i * 24) % model.rowIds.length;
    const rowId = model.rowIds[index];
    if (!rowId) break;
    await waitVisible(() => setCell(doc, rowId, model.aantalColId, String(200 + i)));
  }
}
