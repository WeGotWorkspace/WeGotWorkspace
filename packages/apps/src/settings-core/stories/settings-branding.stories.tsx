import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";

const brandingMeta = createBrandingStoryMeta({
  appId: "settings",
  workspaceClass: "settings-workspace",
  accentToken: "settings-accent",
  component: SettingsWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Settings",
  tags: ["vitest-ci"],
} satisfies Meta<typeof SettingsWorkspace>;

export default meta;
type Story = StoryObj<typeof SettingsWorkspace>;

export const Default: Story = {
  args: {
    ...createSettingsAppBootstrap(),
  },
};
