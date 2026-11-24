/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { MeetWorkspaceHeader } from "@/meet-core/src/meet-workspace-header";
import { MeetWorkspaceSidebar } from "@/meet-core/src/meet-workspace-sidebar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { partitionMeetChannels } from "@/meet-core/src/meet-channel-partition";
import type { MeetChannel } from "@/lib/models/meet-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/meet" } }),
}));

vi.mock("@/app-switch-button/src/use-show-admin-app", () => ({
  useShowAdminApp: () => false,
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => cleanup());

function renderWithTooltips(element: ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

const named: MeetChannel = { id: "c-named", name: "Random", kind: "channel", scope: "personal" };
const web: MeetChannel = {
  id: "c-web",
  name: "Website relaunch",
  kind: "channel",
  scope: "group",
  groupSlug: "design",
  projectId: "p-web",
};

function header(selected: MeetChannel) {
  return renderWithTooltips(
    <MeetWorkspaceHeader
      sidebarOpen
      onToggleSidebar={vi.fn()}
      title={selected.name}
      selected={selected}
      conversationOpen
      showStart={false}
      onStartCall={vi.fn()}
      onEditChannel={vi.fn()}
    />,
  );
}

const session = {
  user: { username: "ada", displayName: "Ada" },
} as unknown as WorkspaceSession;

function sidebar(canCreateChannel: boolean, projectId: string | null = null) {
  return renderWithTooltips(
    <MeetWorkspaceSidebar
      open
      onClose={vi.fn()}
      session={session}
      sections={partitionMeetChannels([named, web], projectId)}
      todayMeetings={[]}
      leftoverUpcoming={[]}
      directMessagePeople={[]}
      selectedId={null}
      onSelect={vi.fn()}
      channelHasLiveCall={() => false}
      channelCallAudioOnly={() => false}
      meetingStartLabel={() => null}
      onCreateChannel={vi.fn()}
      canCreateChannel={canCreateChannel}
      onCreateMeeting={vi.fn()}
    />,
  );
}

describe("Meet under the Project filter (#818)", () => {
  it("shows no edit pencil on a Project channel", () => {
    header(web);
    expect(screen.queryByRole("button", { name: meetLabels.editChannel })).toBeNull();
  });

  it("keeps the edit pencil on a named channel", () => {
    header(named);
    expect(screen.getByRole("button", { name: meetLabels.editChannel })).toBeTruthy();
  });

  it("lists a Projects group apart from My channels", () => {
    sidebar(true);
    expect(screen.getByText(meetLabels.sidebarProjects)).toBeTruthy();
    expect(screen.getByText(meetLabels.sidebarChannels)).toBeTruthy();
  });

  it("offers New channel only while no Project is selected", () => {
    const { unmount } = sidebar(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: meetLabels.newChannelMenu }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(meetLabels.newChannel)).toBeTruthy();
    unmount();

    sidebar(false, "p-web");
    expect(screen.queryByText(meetLabels.sidebarChannels)).toBeNull();
    expect(screen.getByText(meetLabels.sidebarProjects)).toBeTruthy();
    const menu = screen.queryByRole("button", { name: meetLabels.newChannelMenu });
    if (menu) fireEvent.pointerDown(menu, { button: 0, ctrlKey: false });
    expect(screen.queryByText(meetLabels.newChannel)).toBeNull();
  });
});
