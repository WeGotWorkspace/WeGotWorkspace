import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import {
  WorkspaceShellHeader,
  type WorkspaceShellHeaderProps,
} from "@/workspace-shell/src/workspace-shell-header";
import "@/login-core/src/login-screen.css";
import "@/meet-core/src/meet-workspace.css";

const { session: signedInSession } = createMeetAppBootstrap();

const guestSession = {
  user: {
    displayName: "Guest",
    initials: "G",
  },
  viewerInboxLabel: "me",
} as const;

const STORY_NOOP = () => {};

const meta = {
  title: "Shared/Workspace/ShellHeader",
  component: WorkspaceShellHeader,
  parameters: {
    layout: "fullscreen",
    routerPath: "/meet",
  },
} satisfies Meta<typeof WorkspaceShellHeader>;

export default meta;
type Story = StoryObj<typeof WorkspaceShellHeader>;

const meetHeaderShellStyle = {
  backgroundColor: "var(--workspace-home-bg, #1b1d3a)",
  color: "#ffffff",
  "--app-sidebar-bg": "var(--workspace-home-bg, #1b1d3a)",
  "--app-sidebar-color": "#ffffff",
  "--app-switch-lockup-bg": "var(--workspace-home-bg, #1b1d3a)",
  "--app-switch-label-color": "#ffffff",
  "--app-switch-label-tagline-color": "color-mix(in oklab, #ffffff 92%, #1b1d3a)",
} as CSSProperties;

function MeetDarkHeader(args: WorkspaceShellHeaderProps) {
  return (
    <div className="meet-workspace min-h-dvh" style={meetHeaderShellStyle}>
      <WorkspaceShellHeader {...args} />
    </div>
  );
}

export const MeetSignedIn: Story = {
  name: "Meet signed in",
  tags: ["vitest-ci"],
  render: MeetDarkHeader,
  args: {
    session: signedInSession,
    displayName: signedInSession.user.displayName,
    appSwitchDisabled: false,
    showUserAccount: true,
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

export const MeetGuestJoin: Story = {
  name: "Meet guest join",
  render: MeetDarkHeader,
  args: {
    session: guestSession,
    displayName: "Guest",
    appSwitchDisabled: true,
    showUserAccount: false,
    onLogout: STORY_NOOP,
  },
};

export const Login: Story = {
  name: "Login",
  render: (args) => (
    <main className="login-screen min-h-dvh">
      <WorkspaceShellHeader {...args} />
    </main>
  ),
  args: {
    brandLockup: true,
  },
};
