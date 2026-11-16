import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";

const { session } = createMeetAppBootstrap();

/**
 * The header on its own. The app-styled variants live with their app:
 * `Layout/Shell Header (Meet)` and `Layout/Shell Header (Login)`.
 */
const meta = {
  title: "Layout/Shell Header",
  component: WorkspaceShellHeader,
  parameters: {
    layout: "fullscreen",
    routerPath: "/meet",
  },
} satisfies Meta<typeof WorkspaceShellHeader>;

export default meta;
type Story = StoryObj<typeof WorkspaceShellHeader>;

export const SignedIn: Story = {
  name: "Signed in",
  args: {
    session,
    displayName: session.user.displayName,
    appSwitchDisabled: false,
    showUserAccount: true,
    onLogout: fn(),
  },
};
