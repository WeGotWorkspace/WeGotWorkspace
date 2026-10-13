import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { Grid } from "../ycsv-grid/Grid";
import { fileToDoc } from "../ycsv-model";
import { SEED } from "./fixtures";
import largeText from "./fixtures/large.ycsv?raw";
import { measureEdits, measureIndexed, type HeapMarks } from "./measure";

type Dataset = "klein" | "groot";

const user = { id: "meet", name: "Meet", color: "#333" };

function readHeap(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

function PerformanceStory({ dataset }: { dataset: Dataset }) {
  const text = dataset === "groot" ? largeText : SEED;
  const [doc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(doc));
  const heap = useRef<HeapMarks>({ beforeLoad: null, afterLoad: null });
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    heap.current.beforeLoad = readHeap();
    fileToDoc(parse(text), doc);
    heap.current.afterLoad = readHeap();
    setReady(true);
  }, [doc, text]);

  useEffect(() => {
    const host = window as Window & { __runM3?: () => Promise<void> };
    host.__runM3 = () => measureEdits(doc);
    return () => {
      host.__runM3 = undefined;
      awareness.destroy();
    };
  }, [awareness, doc]);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <strong>{dataset}</strong>
        <button
          type="button"
          disabled={!ready || running}
          onClick={() => {
            setRunning(true);
            setReport(null);
            void measureIndexed(doc)
              .then((textOut) => setReport(textOut))
              .catch((error: unknown) => {
                setReport(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setRunning(false));
          }}
        >
          Meet
        </button>
        {running ? <span>bezig…</span> : null}
      </header>
      {ready ? <Grid doc={doc} awareness={awareness} user={user} /> : <div>laden…</div>}
      {report !== null ? <pre data-measure="report">{report}</pre> : null}
    </div>
  );
}

const meta = {
  title: "Sheets/Performance",
  args: { dataset: "groot" as Dataset },
  argTypes: {
    dataset: { control: "radio", options: ["klein", "groot"] },
  },
  render: (args) => <PerformanceStory dataset={args.dataset} />,
} satisfies Meta<{ dataset: Dataset }>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Performance: Story = {
  name: "Performance",
};
