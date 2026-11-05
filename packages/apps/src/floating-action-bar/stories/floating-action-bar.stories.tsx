import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Archive, CheckCircle2, FolderInput, Star, Trash2 } from "lucide-react";
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
    icon: <CheckCircle2 className="size-4" />,
    onClick: () => {},
    separatorBefore: true,
    variant: "selection" as const,
  },
];

/**
 * The count is a dimmed label (check icon + number) with a separator after it; its
 * tooltip spells out the selection. Done uses the selection fill.
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
    await expect(canvas.getByRole("button", { name: "Done" }).className).toContain(
      "button--variant-selection",
    );

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
