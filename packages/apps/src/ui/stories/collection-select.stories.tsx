import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { CollectionSelect, type CollectionSelectItem } from "@/ui/collection-select";
import { TooltipProvider } from "@/ui/tooltip";

/** A plain dot that reads the row colour, as the Notes and Contacts dots do. */
function Dot() {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: "var(--collection-row-color)" }}
    />
  );
}

const ITEMS: CollectionSelectItem[] = [
  { id: "work", name: "Work", color: "oklch(0.68 0.13 240)" },
  { id: "home", name: "Home", color: "oklch(0.7 0.15 30)" },
  { id: "ideas", name: "Ideas", color: "oklch(0.72 0.14 140)" },
];

function CollectionSelectHarness({
  triggerVariant,
  onCreate,
}: {
  triggerVariant: "labeled" | "swatch" | "ghost";
  onCreate?: () => void;
}) {
  const [value, setValue] = useState("work");
  const selected = ITEMS.find((item) => item.id === value)!;
  return (
    <TooltipProvider>
      <CollectionSelect
        items={ITEMS}
        value={value}
        dot={<Dot />}
        color={selected.color}
        triggerLabel={selected.name}
        accessibleName={triggerVariant === "labeled" ? "Notebook" : selected.name}
        triggerVariant={triggerVariant}
        create={onCreate ? { label: "New notebook", onSelect: onCreate } : undefined}
        onValueChange={setValue}
      />
    </TooltipProvider>
  );
}

/**
 * A collection picker (Notes notebook, Contacts address book): each option is the
 * collection's dot and name.
 */
const meta = {
  title: "UI/Primitives/Collection Select",
  component: CollectionSelectHarness,
  tags: ["autodocs", "vitest-ci"],
  args: { triggerVariant: "labeled" },
} satisfies Meta<typeof CollectionSelectHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

async function pick(name: string) {
  await userEvent.click(await within(document.body).findByRole("option", { name }));
}

export const Labeled: Story = {
  args: { triggerVariant: "labeled", onCreate: fn() },
  play: async ({ canvasElement, args }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Notebook" });
    await expect(trigger).toHaveClass("collection-select");
    await userEvent.click(trigger);
    // Each option carries its dot and name; Create sits after a separator.
    await expect(document.querySelector(".collection-select__separator")).toBeTruthy();
    await pick("Home");
    await waitFor(() => expect(trigger).toHaveTextContent("Home"));
    await userEvent.click(trigger);
    await pick("New notebook");
    await expect(args.onCreate).toHaveBeenCalledTimes(1);
    await expect(trigger).toHaveTextContent("Home");
  },
};

export const Swatch: Story = {
  args: { triggerVariant: "swatch" },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Work" });
    await expect(trigger).toHaveClass("collection-select--swatch");
    // The swatch shows the dot only, no name.
    await expect(trigger.querySelector(".collection-select__name")).toBeNull();
    await userEvent.click(trigger);
    await pick("Ideas");
    await waitFor(() =>
      expect(within(canvasElement).getByRole("combobox", { name: "Ideas" })).toBeTruthy(),
    );
  },
};

export const Ghost: Story = {
  args: { triggerVariant: "ghost" },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Work" });
    await expect(trigger).toHaveClass("collection-select--ghost");
    await expect(trigger).toHaveTextContent("Work");
    await userEvent.click(trigger);
    // No Create without a handler.
    await expect(document.querySelector(".collection-select__separator")).toBeNull();
    await pick("Home");
    await waitFor(() =>
      expect(within(canvasElement).getByRole("combobox", { name: "Home" })).toBeTruthy(),
    );
  },
};
