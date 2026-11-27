import * as Y from "yjs";
import type { Value } from "../../ycsv-formula/eval";
import { cellKey, WorkbookEngine } from "./engine";

/**
 * Where formula values come from, as the grid sees it. Literal cells are never asked: the
 * grid reads them from the Y.Doc, so a typed value paints without waiting for the engine.
 *
 * Two hosts:
 * - `InThreadValues`: the engine on the main thread, on the same Y.Doc (spike 4's measured
 *   `win-incr` path). Values are up to date when the Yjs transaction ends.
 * - `WorkerValues`: the engine in a Web Worker on a replica Y.Doc fed with every update
 *   (spike 4's worker experiment). The main thread keeps the doc because the collab
 *   session (WebRTC mesh, IndexedDB, awareness, UndoManager) lives there; see
 *   docs/integration-slice.md for why the worker does not own the doc.
 */
export interface ValueSource {
  readonly kind: "main" | "worker";
  /** Resolves when every formula has a value. */
  readonly ready: Promise<void>;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  /** Computed value of a formula cell; undefined until the engine has it. */
  formulaValue(sheetId: string, ref: string, rowId: string): Value | undefined;
  /** Number of updates sent to the engine whose answer has not arrived (always 0 in-thread). */
  pending(): number;
  destroy(): void;
}

export class InThreadValues implements ValueSource {
  readonly kind = "main" as const;
  readonly engine: WorkbookEngine;
  readonly ready: Promise<void>;
  readonly buildMs: number;

  constructor(doc: Y.Doc) {
    const started = performance.now();
    this.engine = new WorkbookEngine(doc);
    this.buildMs = performance.now() - started;
    this.ready = Promise.resolve();
  }

  subscribe = (listener: () => void) => this.engine.subscribe(listener);
  getVersion = () => this.engine.getVersion();
  formulaValue(sheetId: string, ref: string, rowId: string): Value | undefined {
    return this.engine.value(sheetId, ref, rowId);
  }
  pending(): number {
    return 0;
  }
  destroy(): void {
    this.engine.destroy();
  }
}

export type WorkerReady = { kind: "ready"; buildMs: number; keys: string[]; values: Value[] };
export type WorkerDelta = { kind: "delta"; id: number; workerMs: number; evaluated: number; keys: string[]; values: Value[] };
export type WorkerIn = { kind: "init"; state: Uint8Array } | { kind: "update"; update: Uint8Array; id: number };

export class WorkerValues implements ValueSource {
  readonly kind = "worker" as const;
  readonly ready: Promise<void>;
  /** Last delta's numbers (harness). */
  last: { id: number; workerMs: number; evaluated: number; receiveMs: number } = { id: -1, workerMs: 0, evaluated: 0, receiveMs: 0 };
  buildMs = 0;
  private readonly worker: Worker;
  private readonly values = new Map<string, Value>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private sent = 0;
  private answered = 0;
  private readonly waiters: { id: number; resolve: () => void }[] = [];

  constructor(private readonly doc: Y.Doc) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (event: MessageEvent<WorkerReady | WorkerDelta>) => {
        const started = performance.now();
        const data = event.data;
        for (let i = 0; i < data.keys.length; i += 1) this.values.set(data.keys[i] as string, data.values[i] as Value);
        if (data.kind === "ready") {
          this.buildMs = data.buildMs;
          resolve();
        } else {
          this.answered = data.id + 1;
          this.last = { id: data.id, workerMs: data.workerMs, evaluated: data.evaluated, receiveMs: performance.now() - started };
          while (this.waiters.length > 0 && (this.waiters[0] as { id: number }).id < this.answered) this.waiters.shift()?.resolve();
        }
        this.version += 1;
        for (const listener of this.listeners) listener();
      };
    });
    this.worker.postMessage({ kind: "init", state: Y.encodeStateAsUpdate(doc) } satisfies WorkerIn);
    doc.on("update", this.onUpdate);
  }

  private onUpdate = (update: Uint8Array) => {
    this.worker.postMessage({ kind: "update", update, id: this.sent } satisfies WorkerIn);
    this.sent += 1;
  };

  /** Resolves once the worker answered every update sent so far. */
  settled(): Promise<void> {
    if (this.answered >= this.sent) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ id: this.sent - 1, resolve }));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;
  formulaValue(sheetId: string, ref: string, rowId: string): Value | undefined {
    return this.values.get(cellKey(sheetId, ref, rowId));
  }
  pending(): number {
    return this.sent - this.answered;
  }
  destroy(): void {
    this.doc.off("update", this.onUpdate);
    this.worker.terminate();
    this.listeners.clear();
  }
}

export type EngineMode = "main" | "worker";

export function createValueSource(doc: Y.Doc, mode: EngineMode): ValueSource {
  if (mode === "worker" && typeof Worker !== "undefined") return new WorkerValues(doc);
  return new InThreadValues(doc);
}
