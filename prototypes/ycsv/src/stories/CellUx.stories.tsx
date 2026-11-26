import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { docToFile, fileToDoc } from "../ycsv-model";
import { SheetGrid } from "../ycsv-ux/SheetGrid";

/**
 * Spike 6 — cell UX. One Y.Doc per story render; `window.__sheet` exposes the doc
 * and a serializer for the Playwright tests.
 */
const UX_SEED = `---
ycsv_version: 1
name: Q3 Omzet
columns:
  - ref: product
    name: Product
    type: string
  - ref: aantal
    name: Aantal
    type: number
  - ref: prijs
    name: Prijs
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: totaal
    name: Totaal
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: datum
    name: Datum
    type: string
  - ref: notitie
    name: Notitie
    type: string
defs:
  btw: 0.21
---
product,aantal,prijs,totaal,datum,notitie
Appels,6,0.45,=aantal*prijs*(1+btw),2026-01-01,Item 1
Brood,2,2.99,=aantal*prijs*(1+btw),2026-01-02,
Kaas,1,4.50,=aantal*prijs*(1+btw),,
Wijn,3,8.95,=aantal*prijs*(1+btw),,
Totaal,=SUM(aantal1:aantal4),,=SUM(totaal1:totaal4),,
Fout,=aantal99,,=totaal6,,
`;

function bigSeed(rows: number): string {
  const head = `---
ycsv_version: 1
name: Big
columns:
  - ref: id
    type: number
  - ref: naam
  - ref: bedrag
    type: number
  - ref: dubbel
    type: number
---
id,naam,bedrag,dubbel
`;
  const lines: string[] = [];
  for (let i = 1; i <= rows; i += 1) lines.push(`${i},Item ${i},${(i * 7) % 1000},=bedrag*2`);
  return head + lines.join("\n") + "\n";
}

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
