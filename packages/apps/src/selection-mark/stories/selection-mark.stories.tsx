import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { SelectionMark } from "@/selection-mark/src/selection-mark";

const meta = {
  title: "UI/Primitives/Selection Mark",
  component: SelectionMark,
  tags: ["autodocs", "vitest-ci"],
  parameters: {
    docs: {
      description: {
        component:
          "The one multi-select mark for every list and grid (Notes, Contacts, Tasks rows; the Drive and Docs browser). An empty ring; checked, a solid fill in the selection tint with a dark check.",
      },
    },
  },
  args: { checked: true },
  render: () => (
    <div className="flex items-center gap-3">
      <SelectionMark checked={false} />
      <SelectionMark checked />
    </div>
  ),
} satisfies Meta<typeof SelectionMark>;

export default meta;
type Story = StoryObj<typeof meta>;

const lightness = (color: string) => Number(/oklch\(([\d.]+)/.exec(color)?.[1] ?? "1");

/** Unchecked: an empty ring. Checked: one solid fill (the edge colour) with a dark check. */
export const States: Story = {
  play: async ({ canvasElement }) => {
    const [unchecked, checked] = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".selection-mark"),
    );
    await expect(getComputedStyle(unchecked).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await expect(unchecked.querySelector("svg")).toBeNull();
    await expect(getComputedStyle(checked).backgroundColor).toBe(
      getComputedStyle(checked).borderTopColor,
    );
    const icon = checked.querySelector(".selection-mark__icon") as SVGElement;
    await expect(lightness(getComputedStyle(icon).color)).toBeLessThan(0.25);
  },
};

/** Dark: a bright sky fill with a deep navy check. */
export const StatesDark: Story = {
  ...States,
  decorators: [withDarkTheme],
};
