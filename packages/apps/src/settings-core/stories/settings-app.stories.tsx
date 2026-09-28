import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";

registerBuiltinSettings();

const meta: Meta<typeof SettingsWorkspace> = {
  title: "Features/Settings",
  component: SettingsWorkspace,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof SettingsWorkspace>;

export const Default: Story = {
  args: {
    ...createSettingsAppBootstrap(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Account" })).toBeTruthy();
    await expect(canvas.getByRole("heading", { name: "Apps" })).toBeTruthy();
    await expect(canvas.getByRole("button", { name: "Mail" })).toBeTruthy();
    await expect(canvas.queryByRole("button", { name: "Notifications" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Connected assistants" })).toBeTruthy();
  },
};

/** Chrome Default lives under Themes/Settings — this story covers MCP-off gating. */
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
    await expect(canvas.getByRole("button", { name: "Mail" })).toBeTruthy();
    await expect(canvas.queryByRole("button", { name: "Notifications" })).toBeNull();
  },
};
