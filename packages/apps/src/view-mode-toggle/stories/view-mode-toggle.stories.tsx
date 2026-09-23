import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";

const meta = {
  title: "UI/Primitives/View Mode Toggle",
  component: ViewModeToggle,
  tags: ["autodocs", "vitest-ci"],
  argTypes: {
    value: { control: "radio", options: ["grid", "list"] },
  },
} satisfies Meta<typeof ViewModeToggle>;

export default meta;
type Story = StoryObj<typeof ViewModeToggle>;

export const Grid: Story = {
  args: {
    value: "grid",
    gridLabel: "Grid view",
    listLabel: "List view",
    onChange: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "List view" }));
    await expect(args.onChange).toHaveBeenCalledWith("list");
  },
};

export const List: Story = {
  args: {
    value: "list",
    gridLabel: "Grid view",
    listLabel: "List view",
    onChange: () => {},
  },
};
