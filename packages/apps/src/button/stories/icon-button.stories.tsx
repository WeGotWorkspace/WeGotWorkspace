import type { Meta, StoryObj } from "@storybook/react-vite";
import { Star } from "lucide-react";
import { BUTTON_VARIANT_OPTIONS, ICON_BUTTON_SIZE_OPTIONS, IconButton } from "../src/button";

const meta: Meta<typeof IconButton> = {
  title: "Shared/Buttons/Icon Button",
  component: IconButton,
  argTypes: {
    size: {
      control: "select",
      options: ICON_BUTTON_SIZE_OPTIONS,
    },
    variant: {
      control: "select",
      options: BUTTON_VARIANT_OPTIONS,
    },
  },
};

export default meta;

export const Default: StoryObj<typeof IconButton> = {
  args: {
    label: "Favorite",
    icon: <Star />,
    size: "md",
    variant: "subtle",
    onClick: () => {},
  },
  render: (args) => <IconButton {...args} />,
};

export const Active: StoryObj<typeof IconButton> = {
  ...Default,
  args: { ...Default.args, active: true },
};

export const Ghost: StoryObj<typeof IconButton> = {
  ...Default,
  args: { ...Default.args, variant: "ghost" },
};

export const DestructiveOutline: StoryObj<typeof IconButton> = {
  ...Default,
  args: { ...Default.args, variant: "destructive-outline" },
};

export const Disabled: StoryObj<typeof IconButton> = {
  ...Default,
  args: { ...Default.args, disabled: true },
};
