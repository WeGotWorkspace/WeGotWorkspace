import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { evaluateAll, type RawCells } from "../ycsv-formula";
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

export async function measureEdits(doc: Y.Doc): Promise<void> {
  const model = readModel(doc);
  for (let i = 0; i < 50; i += 1) {
    const index = (i * 24) % model.rowIds.length;
    const rowId = model.rowIds[index];
    if (!rowId) break;
    await waitVisible(() => setCell(doc, rowId, model.aantalColId, String(200 + i)));
  }
}
