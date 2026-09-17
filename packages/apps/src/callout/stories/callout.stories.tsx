import type { Meta, StoryObj } from "@storybook/react-vite";
import { Undo2, PackageCheck } from "lucide-react";
import { Button } from "@/button/src/button";
import { Callout } from "../src/callout";

const meta = {
  title: "Shared/Callout",
  component: Callout,
  tags: ["vitest-ci"],
  args: {
    severity: "info" as const,
    title: "Callout title",
    message: "Supporting message text.",
  },
  argTypes: {
    title: { control: "text" },
    message: { control: "text" },
    severity: {
      control: "select",
      options: ["info", "success", "warning", "error"],
    },
    icon: { control: false },
    action: { control: false },
    className: { control: false },
  },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof Callout>;

export const Info: Story = {
  args: {
    severity: "info",
    title: "Info",
    message: "This is an info message. No action required.",
  },
};

export const CustomIcon: Story = {
  args: {
    ...Info.args,
    icon: <PackageCheck className="callout__icon" />,
  },
};

export const WithAction: Story = {
  args: {
    ...Info.args,
    action: (
      <Button
        label="Undo"
        variant="primary"
        size="md"
        icon={<Undo2 className="size-4" aria-hidden />}
        variant="outline"
        onClick={() => {}}
      />
    ),
  },
};

export const Success: Story = {
  args: {
    severity: "success",
    title: "You're up to date",
    message: "Running the latest stable release. No action required.",
  },
};

export const Warning: Story = {
  args: {
    severity: "warning",
    title: "Update available",
    message: "v2.5.0 introduces faster sync and security patches. Checked on 2026-05-08 13:00.",
  },
};

export const Error: Story = {
  args: {
    severity: "error",
    title: "Update failed",
    message: "Integrity check failed for downloaded package. Try again or inspect server logs.",
  },
};
