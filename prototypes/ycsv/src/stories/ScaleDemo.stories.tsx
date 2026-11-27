import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as Y from "yjs";
import { fileToDoc, insertRowAfter } from "../ycsv-model";
import { SheetEngine, deleteRowAt, pasteBlock, setCellAt, type EngineMode } from "../scale/engine";
import { buildScaleFile, type ScaleWidth } from "../scale/generate";
import { ScaleGrid } from "../scale/ScaleGrid";

/** Spike 4 demo: a large generated sheet in the windowed grid, with buttons for the measured actions. */
type Args = { rows: number; cols: ScaleWidth; engine: EngineMode };

function Demo({ rows, cols, engine: mode }: Args) {
  const [state, setState] = useState<{ doc: Y.Doc; engine: SheetEngine; loadMs: number; yjsBytes: number } | null>(null);
  const [last, setLast] = useState("");

  useEffect(() => {
    setState(null);
    const timer = setTimeout(() => {
      const started = performance.now();
      const doc = new Y.Doc();
      fileToDoc(buildScaleFile(rows, cols), doc);
      const engine = new SheetEngine(doc, mode);
      setState({ doc, engine, loadMs: performance.now() - started, yjsBytes: Y.encodeStateAsUpdate(doc).byteLength });
    }, 30);
    return () => clearTimeout(timer);
  }, [rows, cols, mode]);

  if (!state) return <div style={{ padding: 16, fontFamily: "sans-serif" }}>Sheet bouwen ({rows.toLocaleString("nl-NL")} × {cols})…</div>;
  return <Loaded {...state} last={last} setLast={setLast} rows={rows} cols={cols} mode={mode} />;
}

function Loaded({
  doc,
  engine,
  loadMs,
  yjsBytes,
  last,
  setLast,
  rows,
  cols,
  mode,
}: {
  doc: Y.Doc;
  engine: SheetEngine;
  loadMs: number;
  yjsBytes: number;
  last: string;
  setLast: (value: string) => void;
  rows: number;
  cols: number;
  mode: EngineMode;
}) {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  const colId = (ref: string) => engine.columns.find((column) => column.ref === ref)?.colId ?? "";
  const run = (label: string, action: () => void) => {
    const started = performance.now();
    action();
    const sync = performance.now() - started;
    requestAnimationFrame(() =>
      setTimeout(() =>
        setLast(
          `${label}: ${sync.toFixed(1)} ms rekenen, ${(performance.now() - started).toFixed(1)} ms tot scherm, ${engine.stats.lastEvaluated.toLocaleString("nl-NL")} cellen herberekend`,
        ),
      ),
    );
  };
  const mid = Math.floor(engine.rowIds.length / 2);
  const button = { padding: "4px 10px", font: "inherit" };

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", fontSize: 14 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8, color: "#444" }}>
        <span>
          <strong>{rows.toLocaleString("nl-NL")} × {cols}</strong> ({(rows * cols).toLocaleString("nl-NL")} cellen), engine: {mode}
        </span>
        <span>laden {loadMs.toFixed(0)} ms</span>
        <span>Yjs {(yjsBytes / 1048576).toFixed(1)} MB {yjsBytes > 5 * 1048576 ? "(boven 5 MiB-limiet)" : ""}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button style={button} type="button" onClick={() => run("aantal rij 1", () => setCellAt(doc, 0, colId("aantal"), String(1 + Math.floor(Math.random() * 99))))}>
          Wijzig aantal in rij 1
        </button>
        <button style={button} type="button" onClick={() => run("tarief (alle rijen)", () => setCellAt(doc, 0, colId("tarief"), (0.05 + Math.random() * 0.2).toFixed(2)))}>
          Wijzig tarief (elke rij hangt ervan af)
        </button>
        <button style={button} type="button" onClick={() => run("rij invoegen", () => insertRowAfter(doc, mid))}>
          Rij invoegen (midden)
        </button>
        <button style={button} type="button" onClick={() => run("rij verwijderen", () => deleteRowAt(doc, mid))}>
          Rij verwijderen (midden)
        </button>
        <button
          style={button}
          type="button"
          onClick={() =>
            run("plak 1.000 cellen", () =>
              pasteBlock(doc, 0, [colId("aantal"), colId("prijs"), colId("korting")], Array.from({ length: 334 }, (_, r) => [String((r % 40) + 1), "9.99", "0.1"])),
            )
          }
        >
          Plak 1.000 cellen (bovenaan)
        </button>
      </div>
      <div style={{ minHeight: 20, marginBottom: 8, color: "#0a5" }}>{last}</div>
      <ScaleGrid engine={engine} height={560} width={1200} />
    </div>
  );
}

const meta = {
  title: "Sheets/Scale demo",
  args: { rows: 50000, cols: 10, engine: "incremental" },
  argTypes: {
    rows: { control: "select", options: [1000, 10000, 25000, 50000, 100000] },
    cols: { control: "radio", options: [10, 30] },
    engine: { control: "radio", options: ["incremental", "full"] },
  },
  render: (args) => <Demo {...args} />,
} satisfies Meta<Args>;

export default meta;

export const Demo50k: StoryObj<typeof meta> = { name: "50.000 × 10" };
export const Demo10k30: StoryObj<typeof meta> = { name: "10.000 × 30", args: { rows: 10000, cols: 30 } };
