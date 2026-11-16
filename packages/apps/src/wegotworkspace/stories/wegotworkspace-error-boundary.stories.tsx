import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { WeGotWorkspaceErrorFallback } from "@/wegotworkspace/src/wegotworkspace-error-boundary";

/**
 * What `WeGotWorkspaceErrorBoundary` shows when the shell crashes outside a route
 * (#2204). The error is kept on the device for Settings → Diagnostics.
 */
const meta = {
  title: "Features/WeGotWorkspace/Error fallback",
  component: WeGotWorkspaceErrorFallback,
  parameters: { layout: "fullscreen" },
  args: { onReload: fn() },
  play: async ({ args }) => {
    await expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(
      screen.getByRole("link", { name: "Settings → Diagnostics" }).getAttribute("href"),
    ).toBe("/settings/diagnostics");
    screen.getByRole("button", { name: "Reload" }).click();
    await expect(args.onReload).toHaveBeenCalledOnce();
  },
} satisfies Meta<typeof WeGotWorkspaceErrorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = {
  decorators: [withDarkTheme],
};
