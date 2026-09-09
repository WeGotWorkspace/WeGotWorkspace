import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";

const meta: Meta<typeof SettingsWorkspace> = {
  title: "Apps/Settings",
  component: SettingsWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof SettingsWorkspace>;

export const Default: Story = {
  args: {
    ...createSettingsAppBootstrap(),
  },
};

export const DisabledByAdmin: Story = {
  args: {
    ...createSettingsAppBootstrap({
      data: { ...createSettingsAppBootstrap().data, mcpEnabled: false },
    }),
    initialSection: "assistants",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Connected assistants" })).toBeNull();
    await expect(canvas.queryByRole("textbox", { name: "Connection URL" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Profile" })).toBeTruthy();
  },
};
