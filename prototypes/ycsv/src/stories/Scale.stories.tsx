import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Awareness } from "y-protocols/awareness";
import { Grid } from "../ycsv-grid/Grid";
import { ScaleGrid } from "../scale/ScaleGrid";
import { runScale, type Host, type RunConfig, type View } from "../scale/harness";
import { runLayouts, type LayoutConfig } from "../scale/layouts";
import { runWorker, type WorkerConfig } from "../scale/worker-client";

/**
 * Spike 4 measurement page. `scripts/measure.mjs` opens this story in headless Chromium
 * and calls `window.__scale.run(config)`; nothing runs on its own.
 */
const user = { id: "meet", name: "Meet", color: "#333" };
let waiters: (() => void)[] = [];
const signal = () => {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
};
const nextRender = () => new Promise<void>((resolve) => waiters.push(resolve));

function BaselineView({ view }: { view: Extract<View, { kind: "baseline" }> }) {
  const [awareness] = useState(() => new Awareness(view.doc));
  useEffect(() => () => awareness.destroy(), [awareness]);
  return (
    <div data-scroller="" style={{ height: 600, width: 1200, overflow: "auto" }}>
      <Grid doc={view.doc} awareness={awareness} user={user} onRendered={signal} />
    </div>
  );
}

function ScaleLab() {
  const [view, setView] = useState<View>(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    const host: Host = {
      mount: (next) => {
        const rendered = next ? nextRender() : Promise.resolve();
        setView(next);
        return rendered;
      },
      nextRender,
    };
    const api = {
      run: async (config: RunConfig) => {
        setStatus(`running ${JSON.stringify(config)}`);
        const result = await runScale(config, host);
        setStatus("done");
        return result;
      },
      layouts: (config: LayoutConfig) => runLayouts(config),
      worker: (config: WorkerConfig) => runWorker(config),
    };
    (window as Window & { __scale?: typeof api }).__scale = api;
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <div data-status="" style={{ marginBottom: 8 }}>
        {status}
      </div>
      {view?.kind === "baseline" ? <BaselineView view={view} /> : null}
      {view?.kind === "windowed" ? <ScaleGrid engine={view.engine} height={600} width={1200} onPainted={signal} /> : null}
    </div>
  );
}

const meta = {
  title: "Sheets/Scale",
  render: () => <ScaleLab />,
} satisfies Meta;

export default meta;

export const Scale: StoryObj<typeof meta> = { name: "Scale" };
