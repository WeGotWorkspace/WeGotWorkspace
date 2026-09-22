import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";
import { WorkspaceShellHeaderUserMenu } from "@/workspace-shell/src/workspace-shell-header-user-menu";

const meta = {
  title: "Layout/Shell Header User Menu",
  component: WorkspaceShellHeaderUserMenu,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof WorkspaceShellHeaderUserMenu>;

export default meta;
type Story = StoryObj<typeof WorkspaceShellHeaderUserMenu>;

export const Default: Story = {
  args: {
    displayName: "Elias Linden",
    onLogout: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "User menu" }));
    await userEvent.click(body.getByRole("menuitem", { name: /Sign out/i }));
    await expect(args.onLogout).toHaveBeenCalledOnce();
  },
};

export const MeetDark: Story = {
  name: "Meet dark shell",
  render: (args) => (
    <MeetStoryScope className="p-6">
      <WorkspaceShellHeaderUserMenu {...args} />
    </MeetStoryScope>
  ),
  args: {
    displayName: "Demo User",
    onLogout: fn(),
  },
};
