import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { VisibilityDot } from "@/collection-sidebar/src/visibility-dot";

const meta: Meta<typeof VisibilityDot> = {
  title: "UI/Patterns/Visibility Dot",
  component: VisibilityDot,
  tags: ["autodocs"],
  args: { checked: true, label: "Hide Work", onToggle: fn() },
  render: (args) => (
    <div className="p-4" style={{ "--collection-row-color": "#0ea5e9" } as CSSProperties}>
      <VisibilityDot {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof VisibilityDot>;

/** A row's dot: its own colour while shown. */
export const Checked: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole("checkbox", { name: "Hide Work" });
    await expect(box).toHaveAttribute("aria-checked", "true");
    await userEvent.click(box);
    await expect(args.onToggle).toHaveBeenCalledOnce();
  },
};

/** Grey while hidden. */
export const Unchecked: Story = {
  args: { checked: false, label: "Show Work" },
};

/** A section heading's show/hide-all dot while only some rows are on: half-filled. */
export const Mixed: Story = {
  tags: ["vitest-ci"],
  args: {
    checked: "mixed",
    label: "Show all reminders",
    style: {
      "--visibility-dot-color": "color-mix(in oklab, var(--workspace-foreground) 62%, transparent)",
    } as CSSProperties,
  },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole("checkbox", { name: "Show all reminders" });
    await expect(box).toHaveAttribute("aria-checked", "mixed");
    await expect(box).toHaveAttribute("data-state", "indeterminate");
  },
};
