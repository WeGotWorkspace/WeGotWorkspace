import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eye } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { TooltipProvider } from "@/ui/tooltip";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";

const meta: Meta<typeof CollectionSidebarRow> = {
  title: "Shared/CollectionSidebarRow",
  component: CollectionSidebarRow,
  tags: ["autodocs"],
  args: {
    name: "Work",
    color: "#0ea5e9",
    visible: true,
    selected: true,
    onSelect: fn(),
    onToggleVisibility: fn(),
    onEdit: fn(),
    editLabel: "Edit",
  },
  render: (args) => (
    <TooltipProvider delayDuration={0}>
      <ul className="max-w-xs p-4">
        <CollectionSidebarRow {...args} />
      </ul>
    </TooltipProvider>
  ),
};

export default meta;
type Story = StoryObj<typeof CollectionSidebarRow>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Work" }));
    await expect(args.onSelect).toHaveBeenCalledOnce();
    await expect(args.onToggleVisibility).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("checkbox", { name: "Hide Work" }));
    await expect(args.onToggleVisibility).toHaveBeenCalledOnce();
    await expect(args.onSelect).toHaveBeenCalledOnce();
  },
};

export const NoCheckbox: Story = {
  args: {
    onToggleVisibility: undefined,
    showColorDot: true,
    selected: false,
  },
};

export const WithViewOnlyMark: Story = {
  args: {
    badges: (
      <CollectionSidebarMark label="View only">
        <Eye className="size-3.5" aria-hidden />
      </CollectionSidebarMark>
    ),
  },
};

/** Notes/Docs set workspace `--checkbox-*`; the row must still tint from `color`. */
export const VisibilityTintUnderWorkspaceTokens: Story = {
  name: "Visibility tint under workspace checkbox tokens",
  render: (args) => (
    <TooltipProvider delayDuration={0}>
      <div
        className="max-w-xs p-4"
        style={
          {
            "--checkbox-border-color": "color-mix(in oklab, var(--color-ink) 30%, transparent)",
            "--checkbox-checked-bg": "#f6d176",
            "--checkbox-checked-border": "#f6d176",
            "--checkbox-checked-fg": "var(--color-ink)",
          } as CSSProperties
        }
      >
        <ul>
          <CollectionSidebarRow {...args} />
          <CollectionSidebarRow
            name="Personal"
            color="#22c55e"
            visible
            onSelect={fn()}
            onToggleVisibility={fn()}
          />
        </ul>
      </div>
    </TooltipProvider>
  ),
};
