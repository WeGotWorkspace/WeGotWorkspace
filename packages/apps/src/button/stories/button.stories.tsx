import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PenSquare } from "lucide-react";
import { BUTTON_SIZE_OPTIONS, BUTTON_VARIANT_OPTIONS, Button } from "../src/button";

const meta: Meta<typeof Button> = {
  title: "UI/Primitives/Button",
  component: Button,
  tags: ["vitest-ci"],
  argTypes: {
    size: {
      control: "select",
      options: BUTTON_SIZE_OPTIONS,
    },
    variant: {
      control: "select",
      options: BUTTON_VARIANT_OPTIONS,
    },
    pill: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    label: "Compose",
    icon: <PenSquare />,
    variant: "primary",
    onClick: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Compose" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const PrimaryPill: Story = {
  args: { ...Primary.args, size: "xl", pill: true },
};

export const AllSizes: Story = {
  name: "Sizes (xs–xl)",
  render: () => (
    <div className="flex flex-wrap items-end gap-3">
      {BUTTON_SIZE_OPTIONS.map((size) => (
        <Button key={size} label={`${size}`} size={size} variant="outline" onClick={() => {}} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const size of BUTTON_SIZE_OPTIONS) {
      await expect(canvas.getByRole("button", { name: size })).toHaveClass(`button--size-${size}`);
    }
  },
};

export const Ghost: Story = {
  args: { ...Primary.args, variant: "ghost" },
};

export const Outline: Story = {
  args: { ...Primary.args, variant: "outline" },
};

export const Destructive: Story = {
  args: { ...Primary.args, variant: "destructive" },
};

export const DestructiveOutline: Story = {
  args: { ...Primary.args, variant: "destructive-outline" },
};

export const Link: Story = {
  args: { ...Primary.args, variant: "link", icon: undefined, label: "Learn more" },
};

export const Disabled: Story = {
  args: { ...Primary.args, disabled: true },
};
