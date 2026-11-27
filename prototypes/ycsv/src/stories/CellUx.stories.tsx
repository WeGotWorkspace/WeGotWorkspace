import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import type { EngineMode } from "../sheets-core/engine/host";
import { sheetIds, SheetView } from "../sheets-core/model";
import { setLocalSheetPresence } from "../sheets-core/collab";
import { WorkbookView } from "../ycsv-ux/WorkbookView";
import { bookFromText, handleFor } from "./book-harness";
import { bigSeed, UX_SEED } from "./ux-seeds";

/**
 * Spike 6 — cell UX, on the integration slice's workbook model. One Y.Doc per story
 * render; `window.__sheet` exposes test hooks (see book-harness.ts).
 */

function wideSeed(rows: number, cols: number): string {
  const refs = Array.from({ length: cols }, (_, c) => `k${c + 1}`);
  const head = `---
ycsv_version: 1
name: Wide
columns:
${refs.map((r, c) => `  - ref: ${r}\n    name: Kolom ${c + 1}\n    type: number`).join("\n")}
---
${refs.join(",")}
`;
  const lines: string[] = [];
  for (let i = 1; i <= rows; i += 1) lines.push(refs.map((_, c) => (c === 2 ? "=k1+k2" : String(i * (c + 1)))).join(","));
  return head + lines.join("\n") + "\n";
}

type FocusModel = "descendant" | "cell";

function Demo({ seed, theme, frozen, focusModel, autoFocus, engine }: { seed: string; theme: "light" | "dark"; frozen?: number; focusModel?: FocusModel; autoFocus?: boolean; engine?: EngineMode }) {
  const doc = useMemo(() => bookFromText(seed, frozen), [seed, frozen]);
  const [, force] = useState(0);
  useEffect(() => {
    window.__sheet = handleFor(doc);
    force((n) => n + 1);
  }, [doc]);
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: theme === "dark" ? "#18181b" : "#fff" }}>
      <WorkbookView doc={doc} theme={theme} focusModel={focusModel} autoFocus={autoFocus} engine={engine} />
    </main>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Spike 6/Cell UX",
  component: Demo,
  args: { seed: UX_SEED, theme: "light", focusModel: "descendant", engine: "main" },
  argTypes: {
    seed: { control: false },
    theme: { control: "inline-radio", options: ["light", "dark"] },
    focusModel: { control: "inline-radio", options: ["descendant", "cell"] },
    engine: { control: "inline-radio", options: ["main", "worker"] },
  },
};
export default meta;

type Story = StoryObj<typeof Demo>;

export const Grid: Story = {};
export const Dark: Story = { args: { theme: "dark" } };
export const FrozenHeaderRow: Story = { args: { seed: bigSeed(200), frozen: 1 } };
export const TenThousandRows: Story = { args: { seed: bigSeed(10_000) } };
export const Empty: Story = {
  args: {
    seed: `---
ycsv_version: 1
name: Leeg
columns:
  - ref: a
  - ref: b
  - ref: c
  - ref: d
---
a,b,c,d
${Array.from({ length: 20 }, () => ",,,").join("\n")}
`,
  },
};

/**
 * Multi-caret view: two people on two synced Y.Docs side by side, plus a third
 * peer ("Chris") who only exists in awareness and wanders around.
 */
const PEOPLE = [
  { id: "anna", name: "Anna", color: "#d6336c" },
  { id: "ben", name: "Ben", color: "#2b8a3e" },
];
const CHRIS = { id: "chris", name: "Chris", color: "#e8590c" };

function TwoUsersDemo({ seed, theme, focusModel, remoteWindowMs }: { seed: string; theme: "light" | "dark"; focusModel?: FocusModel; remoteWindowMs?: number }) {
  const sessions = useMemo(() => {
    const a = bookFromText(seed);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "remote");
    a.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(b, u, "remote"));
    b.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(a, u, "remote"));
    const docs = [a, b];
    const aws = docs.map((d) => new Awareness(d));
    const bot = new Awareness(new Y.Doc());
    const all = [...aws, bot];
    for (const from of all)
      from.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === "remote") return;
        const u = encodeAwarenessUpdate(from, [...added, ...updated, ...removed]);
        for (const to of all) if (to !== from) applyAwarenessUpdate(to, u, "remote");
      });
    return { docs, aws, bot };
  }, [seed]);

  // Chris walks over a few cells and ranges.
  useEffect(() => {
    const { docs, bot } = sessions;
    const sheetId = sheetIds(docs[0]!)[0]!;
    const view = new SheetView(docs[0]!, sheetId);
    const rid = (i: number) => view.rowIds[Math.min(i, view.rowIds.length - 1)]!;
    const cid = (i: number) => view.colIds[Math.min(i, view.colIds.length - 1)]!;
    const stops = [
      [1, 2, 1, 2],
      [1, 1, 3, 1],
      [2, 0, 2, 0],
      [5, 0, 5, 3],
    ] as const;
    let i = 0;
    const step = () => {
      const [r1, c1, r2, c2] = stops[i % stops.length]!;
      bot.setLocalStateField("user", CHRIS);
      setLocalSheetPresence(bot, {
        sheetId,
        active: { rowId: rid(r1), colId: cid(c1) },
        ranges: [{ anchor: { rowId: rid(r1), colId: cid(c1) }, head: { rowId: rid(r2), colId: cid(c2) } }],
        editing: false,
      });
      i += 1;
    };
    step();
    const t = window.setInterval(step, 1600);
    return () => {
      window.clearInterval(t);
      view.destroy();
    };
  }, [sessions]);

  useEffect(() => {
    const doc = sessions.docs[0]!;
    window.__sheet = handleFor(doc);
    window.__sheetB = handleFor(sessions.docs[1]!);
  }, [sessions]);

  const bg = theme === "dark" ? "#18181b" : "#fff";
  const fg = theme === "dark" ? "#e4e4e7" : "#3f3f46";
  return (
    <main style={{ height: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: bg }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Two people in one sheet</h1>
      {sessions.docs.map((doc, i) => (
        <div key={PEOPLE[i]!.id} style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ font: "600 12px system-ui", padding: "6px 8px", color: fg }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: PEOPLE[i]!.color, marginRight: 6 }} />
            {PEOPLE[i]!.name}'s screen
          </div>
          <WorkbookView doc={doc} theme={theme} awareness={sessions.aws[i]} user={PEOPLE[i]} focusModel={focusModel} remoteWindowMs={remoteWindowMs} />
        </div>
      ))}
    </main>
  );
}

export const TwoUsers: Story = { render: (args) => <TwoUsersDemo seed={args.seed} theme={args.theme} /> };
export const TwoUsersDark: Story = { args: { theme: "dark" }, render: (args) => <TwoUsersDemo seed={args.seed} theme={args.theme} /> };

/* ---- Spike 8: accessibility ------------------------------------------------------------- */
/** The proposed focus model: DOM focus on the active gridcell. */
export const A11yCell: Story = { args: { focusModel: "cell" } };
/** Rows and columns windowed: 10 000 rows × 30 columns. */
export const A11yWide: Story = { args: { seed: wideSeed(10_000, 30), focusModel: "cell" } };
export const A11yWideDescendant: Story = { args: { seed: wideSeed(10_000, 30), focusModel: "descendant" } };
/** Two people; remote digest window shortened to 1.5 s for tests and manual screen reader runs. */
export const A11yTwoUsers: Story = {
  args: { focusModel: "cell" },
  render: (args) => <TwoUsersDemo seed={args.seed} theme={args.theme} focusModel={args.focusModel} remoteWindowMs={1500} />,
};

/* ---- Integration slice: workbooks --------------------------------------------------------- */
const MULTI_SEED = `---
ycsv_version: 1
defs:
  btw: 0.21
sheets:
  - ref: producten
    name: Producten
    columns:
      - ref: product
        type: string
      - ref: categorie
        type: string
      - ref: prijs
        type: number
      - ref: incl
        type: number
      - ref: label
        type: string
  - ref: categorieën
    name: Categorieën
    columns:
      - ref: id
        type: string
      - ref: label
        type: string
      - ref: aantal
        type: number
---
product,categorie,prijs,incl,label
Appels,fruit,0.45,=prijs1*(1+btw),=categorieën!label1
Brood,bakkerij,2.99,=prijs2*(1+btw),=categorieën!label2
Melk,zuivel,1.19,=prijs3*(1+btw),=SUM(categorieën!aantal1:categorieën!aantal3)
---
id,label,aantal
fruit,Fruit,1
bakkerij,Bakkerij,2
zuivel,Zuivel,3
`;
/** Two sheets with cross-sheet refs; formulas in the worker. */
export const Workbook: Story = { args: { seed: MULTI_SEED, focusModel: "cell", engine: "worker" } };
/** Same, engine on the main thread. */
export const WorkbookMainThread: Story = { args: { seed: MULTI_SEED, focusModel: "cell", engine: "main" } };
/** Two people in a two-sheet workbook. */
export const WorkbookTwoUsers: Story = {
  args: { seed: MULTI_SEED, focusModel: "cell" },
  render: (args) => <TwoUsersDemo seed={args.seed} theme={args.theme} focusModel={args.focusModel} remoteWindowMs={1500} />,
};
