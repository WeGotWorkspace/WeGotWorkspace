import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { docToFile, fileToDoc } from "../ycsv-model";
import { SheetGrid } from "../ycsv-ux/SheetGrid";
import { bigSeed, UX_SEED } from "./ux-seeds";

/**
 * Spike 6 — cell UX. One Y.Doc per story render; `window.__sheet` exposes the doc
 * and a serializer for the Playwright tests.
 */
declare global {
  interface Window {
    __sheet?: {
      doc: Y.Doc;
      serialize: () => string;
      cells: () => string[][];
    };
  }
}

function Demo({ seed, theme, frozen }: { seed: string; theme: "light" | "dark"; frozen?: number }) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    fileToDoc(parse(seed), d);
    if (frozen) d.getMap("meta").set("frozen_rows", frozen);
    return d;
  }, [seed, frozen]);
  const [, force] = useState(0);
  useEffect(() => {
    window.__sheet = {
      doc,
      serialize: () => serialize(docToFile(doc)),
      cells: () => docToFile(doc).rows,
    };
    force((n) => n + 1);
  }, [doc]);
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: theme === "dark" ? "#18181b" : "#fff" }}>
      <SheetGrid doc={doc} theme={theme} />
    </div>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Spike 6/Cell UX",
  component: Demo,
  args: { seed: UX_SEED, theme: "light" },
  argTypes: { seed: { control: false }, theme: { control: "inline-radio", options: ["light", "dark"] } },
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

function TwoUsersDemo({ seed, theme }: { seed: string; theme: "light" | "dark" }) {
  const sessions = useMemo(() => {
    const a = new Y.Doc();
    fileToDoc(parse(seed), a);
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
    const rows = docs[0]!.getArray<Y.Map<unknown>>("rows");
    const cols = docs[0]!.getArray<Y.Map<unknown>>("columns");
    const rid = (i: number) => String(rows.get(Math.min(i, rows.length - 1))?.get("rowId"));
    const cid = (i: number) => String(cols.get(Math.min(i, cols.length - 1))?.get("colId"));
    const stops = [
      [1, 2, 1, 2],
      [1, 1, 3, 1],
      [2, 0, 2, 0],
      [5, 0, 5, 3],
    ] as const;
    let i = 0;
    const step = () => {
      const [r1, c1, r2, c2] = stops[i % stops.length]!;
      bot.setLocalState({
        user: CHRIS,
        cursor: { rowId: rid(r1), colId: cid(c1) },
        ranges: [{ r1: rid(r1), r2: rid(r2), c1: cid(c1), c2: cid(c2) }],
      });
      i += 1;
    };
    step();
    const t = window.setInterval(step, 1600);
    return () => window.clearInterval(t);
  }, [sessions]);

  useEffect(() => {
    const doc = sessions.docs[0]!;
    window.__sheet = { doc, serialize: () => serialize(docToFile(doc)), cells: () => docToFile(doc).rows };
  }, [sessions]);

  const bg = theme === "dark" ? "#18181b" : "#fff";
  const fg = theme === "dark" ? "#e4e4e7" : "#3f3f46";
  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: bg }}>
      {sessions.docs.map((doc, i) => (
        <div key={PEOPLE[i]!.id} style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ font: "600 12px system-ui", padding: "6px 8px", color: fg }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: PEOPLE[i]!.color, marginRight: 6 }} />
            {PEOPLE[i]!.name}'s screen
          </div>
          <SheetGrid doc={doc} theme={theme} awareness={sessions.aws[i]} user={PEOPLE[i]} />
        </div>
      ))}
    </div>
  );
}

export const TwoUsers: Story = { render: (args) => <TwoUsersDemo seed={args.seed} theme={args.theme} /> };
export const TwoUsersDark: Story = { args: { theme: "dark" }, render: (args) => <TwoUsersDemo seed={args.seed} theme={args.theme} /> };
