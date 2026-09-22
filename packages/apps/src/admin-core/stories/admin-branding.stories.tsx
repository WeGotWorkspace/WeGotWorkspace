import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { AdminWorkspace } from "@/admin-core/src/admin-workspace";

const brandingMeta = createBrandingStoryMeta({
  appId: "admin",
  workspaceClass: "admin-workspace",
  accentToken: "admin-accent",
  component: AdminWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Admin",
  tags: ["vitest-ci"],
} satisfies Meta<typeof AdminWorkspace>;

export default meta;
type Story = StoryObj<typeof AdminWorkspace>;

export const Default: Story = {
  args: {
    ...createAdminAppBootstrap(),
  },
};
