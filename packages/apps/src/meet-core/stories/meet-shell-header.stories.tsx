import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";
import { WorkspaceShellHeaderUserMenu } from "@/workspace-shell/src/workspace-shell-header-user-menu";
import {
  WorkspaceShellHeader,
  type WorkspaceShellHeaderProps,
} from "@/workspace-shell/src/workspace-shell-header";
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

/** The shared shell header on Meet's dark workspace (moved from the Shell Header stories, #1638). */
const meta = {
  title: "Layout/Shell Header (Meet)",
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
    await userEvent.click(canvas.getByRole("button", { name: /^User menu/ }));
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

export const UserMenuDark: StoryObj<typeof WorkspaceShellHeaderUserMenu> = {
  name: "User menu, Meet dark shell",
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
