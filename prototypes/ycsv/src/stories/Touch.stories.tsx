import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { docToFile, fileToDoc } from "../ycsv-model";
import { SheetGrid } from "../ycsv-ux/SheetGrid";
import type { TouchVariant } from "../ycsv-ux/touch";
import { TouchHud } from "./touch-hud";
import { bigSeed, UX_SEED } from "./ux-seeds";

/**
 * Spike 7 — touch. The spike 6 grid with the touch variants for decision 5:
 * A = tap / double-tap / long-press menu / finger fill handle,
 * B = A + draggable range handles,
 * C = B + hold-to-drag (Calendar parity: hold 160 ms, then drag selects, moves or resizes).
 * Use a phone or tablet (or device emulation).
 */
type Args = { seed: string; variant: TouchVariant; frozen?: number; hud?: boolean; overscan?: number; holdMs?: number; holdSlop?: number; theme: "light" | "dark" };

function TouchDemo({ seed, variant: initial, frozen, hud, overscan, holdMs, holdSlop, theme }: Args) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    fileToDoc(parse(seed), d);
    if (frozen) d.getMap("meta").set("frozen_rows", frozen);
    return d;
  }, [seed, frozen]);
  const [variant, setVariant] = useState<TouchVariant>(initial);
  useEffect(() => setVariant(initial), [initial]);
  useEffect(() => {
    window.__sheet = { doc, serialize: () => serialize(docToFile(doc)), cells: () => docToFile(doc).rows };
  }, [doc]);
  const dark = theme === "dark";
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: dark ? "#18181b" : "#fff", color: dark ? "#f4f4f5" : "#18181b" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", font: "600 13px system-ui", borderBottom: `1px solid ${dark ? "#2e2e33" : "#e4e4e7"}` }}>
        <span style={{ flex: 1 }}>{String(parse(seed).frontmatter.name ?? "Sheet")}</span>
        <div role="radiogroup" aria-label="Touch variant" style={{ display: "flex", border: "1px solid #d4d4d8", borderRadius: 6, overflow: "hidden" }}>
          {(["a", "b", "c"] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={variant === v}
              data-testid={`variant-${v}`}
              onClick={() => setVariant(v)}
              style={{
                font: "500 13px system-ui",
                minWidth: 44,
                height: 32,
                border: 0,
                background: variant === v ? "#0045ff" : "transparent",
                color: variant === v ? "#fff" : "inherit",
              }}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <SheetGrid doc={doc} theme={theme} touchVariant={variant} overscan={overscan} holdMs={holdMs} holdSlop={holdSlop} />
      </div>
      {hud ? <TouchHud /> : null}
    </div>
  );
}

const meta: Meta<typeof TouchDemo> = {
  title: "Spike 7/Touch",
  component: TouchDemo,
  args: { seed: UX_SEED, variant: "a", theme: "light" },
  argTypes: {
    seed: { control: false },
    variant: { control: "inline-radio", options: ["a", "b", "c"] },
    holdMs: { control: { type: "number", min: 100, max: 600, step: 10 } },
    holdSlop: { control: { type: "number", min: 2, max: 20, step: 1 } },
    theme: { control: "inline-radio", options: ["light", "dark"] },
  },
};
export default meta;

type Story = StoryObj<typeof TouchDemo>;

export const VariantA: Story = {};
export const VariantB: Story = { args: { variant: "b" } };
export const VariantBDark: Story = { args: { variant: "b", theme: "dark" } };
export const VariantC: Story = { args: { variant: "c" } };
export const VariantCDark: Story = { args: { variant: "c", theme: "dark" } };
/** Variant C with the hold the spike recommends (250 ms) instead of Calendar's 160 ms. */
export const VariantC250: Story = { args: { variant: "c", holdMs: 250 } };
export const FrozenC250: Story = { args: { seed: bigSeed(200), frozen: 1, variant: "c", holdMs: 250 } };
export const FrozenA: Story = { args: { seed: bigSeed(200), frozen: 1 } };
export const FrozenB: Story = { args: { seed: bigSeed(200), frozen: 1, variant: "b" } };
export const FrozenC: Story = { args: { seed: bigSeed(200), frozen: 1, variant: "c" } };
/** 10k rows with the on-screen frame meter, for momentum scrolling on a device. */
export const TenThousandRows: Story = { args: { seed: bigSeed(10_000), hud: true, variant: "b" } };
export const TenThousandRowsC: Story = { args: { seed: bigSeed(10_000), hud: true, variant: "c" } };
