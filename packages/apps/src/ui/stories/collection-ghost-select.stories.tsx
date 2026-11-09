import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { CollectionGhostButton, CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem } from "@/ui/select";

const COLLECTIONS = [
  { id: "work", name: "Work", color: "oklch(0.62 0.16 250)" },
  { id: "home", name: "Home", color: "oklch(0.68 0.15 150)" },
  { id: "ideas", name: "Ideas", color: "oklch(0.8 0.15 85)" },
];

function Dot() {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: "var(--collection-row-color)" }}
    />
  );
}

function GhostSelectHarness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("work");
  const current = COLLECTIONS.find((collection) => collection.id === value) ?? COLLECTIONS[0];
  return (
    <Select value={value} onValueChange={setValue} disabled={disabled}>
      <CollectionGhostSelectTrigger
        aria-label="Notebook"
        disabled={disabled}
        style={{ "--collection-row-color": current.color } as CSSProperties}
        leading={<Dot />}
        label={current.name}
      />
      <SelectContent>
        {COLLECTIONS.map((collection) => (
          <SelectItem key={collection.id} value={collection.id}>
            {collection.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const meta = {
  title: "UI/Primitives/Collection Ghost Select",
  component: CollectionGhostSelectTrigger,
  tags: ["autodocs", "vitest-ci"],
} satisfies Meta<typeof CollectionGhostSelectTrigger>;

export default meta;
type Story = StoryObj<typeof CollectionGhostSelectTrigger>;

/** The collection switcher above a detail title: dot, name, chevron, no chrome. */
export const Default: Story = {
  render: () => <GhostSelectHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Notebook" });
    await expect(trigger).toHaveTextContent("Work");
    await expect(trigger.querySelector(".collection-ghost-select__chevron")).not.toBeNull();
    await expect(getComputedStyle(trigger).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("option", { name: "Home" }));
    await expect(trigger).toHaveTextContent("Home");
  },
};

/** Read-only: the value without a chevron, not clickable. */
export const Disabled: Story = {
  render: () => <GhostSelectHarness disabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", { name: "Notebook" });
    await expect(trigger).toBeDisabled();
    await expect(trigger.querySelector(".collection-ghost-select__chevron")).toBeNull();
  },
};

const onOpenReminders = fn();

/** The same ghost look as a plain button, for a popover or dialog (reminders, a date). */
export const Button: StoryObj<typeof CollectionGhostButton> = {
  render: () => (
    <CollectionGhostButton
      aria-label="Reminders: 2 reminders"
      label="2 reminders"
      onClick={onOpenReminders}
    />
  ),
  play: async ({ canvasElement }) => {
    onOpenReminders.mockClear();
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Reminders: 2 reminders" });
    await expect(button).toHaveClass("collection-ghost-select");
    await userEvent.click(button);
    await expect(onOpenReminders).toHaveBeenCalledTimes(1);
  },
};
