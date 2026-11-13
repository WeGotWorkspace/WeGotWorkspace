import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import "@/login-core/src/login-screen.css";

/** The shared shell header on the login screen (moved from the Shell Header stories, #1638). */
const meta = {
  title: "Layout/Shell Header (Login)",
  component: WorkspaceShellHeader,
  parameters: {
    layout: "fullscreen",
    routerPath: "/meet",
  },
} satisfies Meta<typeof WorkspaceShellHeader>;

export default meta;
type Story = StoryObj<typeof WorkspaceShellHeader>;

export const Login: Story = {
  render: (args) => (
    <main className="login-screen min-h-dvh">
      <WorkspaceShellHeader {...args} />
    </main>
  ),
  args: {
    brandLockup: true,
  },
};
