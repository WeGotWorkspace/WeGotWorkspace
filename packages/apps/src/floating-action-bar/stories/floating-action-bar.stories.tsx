import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Archive, FolderInput, Star, Trash2 } from "lucide-react";
import { FloatingActionBar } from "@/floating-action-bar/src/floating-action-bar";
import "@/floating-action-bar/stories/floating-action-bar.stories.css";

const meta: Meta<typeof FloatingActionBar> = {
  title: "UI/Patterns/Floating Action Bar",
  component: FloatingActionBar,
};
export default meta;
type Story = StoryObj<typeof FloatingActionBar>;

const defaultButtons = [
  { label: "Star", icon: <Star className="size-4" />, onClick: () => {} },
  {
    label: "Archive",
    icon: <Archive className="size-4" />,
    onClick: () => {},
    severity: "danger" as const,
  },
  { label: "Move", icon: <FolderInput className="size-4" />, onClick: () => {} },
  {
    label: "Trash",
    icon: <Trash2 className="size-4" />,
    onClick: () => {},
    severity: "danger" as const,
  },
  {
    label: "Done",
    icon: null,
    onClick: () => {},
    separatorBefore: true,
    showLabel: true,
  },
];

/**
 * The count is a dimmed label (check icon + number) with a separator after it; its
 * tooltip spells out the selection. Done is an outline text button like the rest: its
 * label spelled out (14px), no icon.
 */
export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    items: 5,
    buttons: defaultButtons,
  },
  render: (args) => (
    <div className="floating-action-bar-story--drive relative h-36">
      <FloatingActionBar {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const count = canvasElement.querySelector(".floating-action-bar__count");
    if (!(count instanceof HTMLElement)) throw new Error("Expected the selection count");
    await expect(count).toHaveTextContent("5 Items");
    await expect(count.nextElementSibling).toHaveClass("floating-action-bar__spacer");
    const done = canvas.getByRole("button", { name: "Done" });
    const star = canvas.getByRole("button", { name: "Star" });
    await expect(done).toHaveClass("button--variant-outline");
    await expect(done).toHaveTextContent("Done");
    await expect(done.querySelector("svg")).toBeNull();
    await expect(getComputedStyle(done).fontSize).toBe("14px");
    // Same resting look as the icon actions beside it.
    for (const property of [
      "backgroundColor",
      "color",
      "borderTopColor",
      "borderTopLeftRadius",
      "height",
    ] as const) {
      await expect(getComputedStyle(done)[property]).toBe(getComputedStyle(star)[property]);
    }

    await userEvent.hover(count);
    await waitFor(() =>
      expect(within(document.body).getByRole("tooltip")).toHaveTextContent("5 Items selected"),
    );
  },
};

export const DocsAccent: Story = {
  args: {
    items: 2,
    buttons: defaultButtons,
  },
  render: (args) => (
    <div className="floating-action-bar-story--docs relative h-36">
      <FloatingActionBar {...args} />
    </div>
  ),
};

export const SingularItem: Story = {
  args: {
    items: 1,
    buttons: defaultButtons,
  },
  render: (args) => (
    <div className="floating-action-bar-story--drive relative h-36">
      <FloatingActionBar {...args} />
    </div>
  ),
};
