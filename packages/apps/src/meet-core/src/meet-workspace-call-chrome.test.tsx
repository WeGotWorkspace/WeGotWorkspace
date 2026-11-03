import { createRef, useState, type ComponentProps, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { createMeetChatOperations } from "@/lib/api/mock/meet-chat-operations";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  createMeetStoryController,
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function storyRoom(): MeetCallStageRoomProps {
  const controller = createMeetStoryController(createRef<HTMLVideoElement | null>(), {
    inCall: true,
    status: "in-call",
    elapsedLabel: "2:18",
    micOn: true,
    videoOn: false,
  });
  return {
    controller,
    displayName: "Demo User",
    hasSignedInIdentity: true,
    participantCount: 1,
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
    cameras: STORY_MEET_DEVICES,
    microphones: STORY_MEET_MICROPHONES,
    speakers: STORY_MEET_SPEAKERS,
    activeCamera: STORY_MEET_DEVICES[0]!.id,
    activeMic: STORY_MEET_MICROPHONES[0]!.id,
    activeSpeaker: STORY_MEET_SPEAKERS[0]!.id,
    onSpeakerChange: () => {},
    onCopyLink: () => {},
    onToastInfo: () => {},
    onToastError: () => {},
  };
}

async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

/** Role query scoped to the sidebar, so jsdom only computes styles for its buttons. */
function sidebarButton(container: HTMLElement, name: RegExp) {
  return within(container.querySelector<HTMLElement>(".app-sidebar")!).getByRole("button", {
    name,
  });
}

async function renderWorkspace(
  props: Partial<ComponentProps<typeof MeetWorkspace>> = {},
  leaveCall = vi.fn(async () => undefined),
) {
  const bootstrap = createMeetAppBootstrap();
  const operations = createMeetChatOperations({
    channels: bootstrap.data.channels ?? [],
    messages: bootstrap.data.messages ?? [],
    unfurl: bootstrap.data.unfurl,
    directory: bootstrap.data.directory,
    author: {
      id: bootstrap.session.user.username ?? "demo.user",
      displayName: bootstrap.session.user.displayName,
    },
  });
  operations.leaveCall = leaveCall;
  const view = await renderInRouter(
    <MeetWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      operations={operations}
      onLogout={() => {}}
      initialChannelId="channel-design"
      initialCallLayout="side-by-side"
      callStageRoom={storyRoom()}
      {...props}
    />,
  );
  return { ...view, leaveCall, bootstrap };
}

describe("MeetWorkspace in-channel call chrome", () => {
  beforeEach(() => {
    installMatchMedia();
  });

  // A named role query over the whole workspace recomputes jsdom styles for
  // every button after each re-render (~100ms locally, several times that on
  // CI), which pushed these cases toward the 5s timeout (#1490). The call
  // chrome is aria-labelled, so label lookups and sidebar-scoped channel
  // queries keep the same assertions cheap.
  it("hides joined chrome after switching to another channel and does not hang up", async () => {
    const { leaveCall, container } = await renderWorkspace();

    expect(screen.getByLabelText(meetLabels.leave)).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByLabelText(meetLabels.devices)).toBeInstanceOf(HTMLButtonElement);

    fireEvent.click(sidebarButton(container, /^random/i));

    expect(screen.queryByLabelText(meetLabels.leave)).toBeNull();
    expect(screen.queryByLabelText(meetLabels.devices)).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(screen.getByLabelText(meetLabels.meet)).toBeInstanceOf(HTMLButtonElement);
    expect(leaveCall).not.toHaveBeenCalled();

    fireEvent.click(sidebarButton(container, /^design/i));

    expect(screen.getByLabelText(meetLabels.leave)).toBeInstanceOf(HTMLButtonElement);
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("hides joined chrome after switching to a DM and does not hang up", async () => {
    const { leaveCall, container } = await renderWorkspace();
    expect(screen.getByLabelText(meetLabels.leave)).toBeInstanceOf(HTMLButtonElement);

    fireEvent.click(sidebarButton(container, /Ada Lovelace/i));

    expect(screen.queryByLabelText(meetLabels.leave)).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("does not paint the live call's chrome on a different open conversation", async () => {
    const { leaveCall, container } = await renderWorkspace({
      initialChannelId: "channel-random",
      initialCallLayout: "side-by-side",
      routeChannelId: "channel-random",
      liveCallChannelId: "channel-design",
    });

    expect(screen.queryByLabelText(meetLabels.leave)).toBeNull();
    expect(screen.queryByLabelText(meetLabels.devices)).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(screen.getByRole("heading", { name: "#random" })).toBeTruthy();

    fireEvent.click(sidebarButton(container, /^design/i));

    expect(screen.getByLabelText(meetLabels.leave)).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByLabelText(meetLabels.devices)).toBeInstanceOf(HTMLButtonElement);
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("follows a route change away from the call without hanging up", async () => {
    const bootstrap = createMeetAppBootstrap();
    const leaveCall = vi.fn(async () => undefined);
    const operations = createMeetChatOperations({
      channels: bootstrap.data.channels ?? [],
      messages: bootstrap.data.messages ?? [],
      directory: bootstrap.data.directory,
      author: {
        id: bootstrap.session.user.username ?? "demo.user",
        displayName: bootstrap.session.user.displayName,
      },
    });
    operations.leaveCall = leaveCall;

    function Routed() {
      const [routeChannelId, setRouteChannelId] = useState("channel-design");
      return (
        <>
          <button type="button" onClick={() => setRouteChannelId("channel-random")}>
            go-random
          </button>
          <MeetWorkspace
            data={bootstrap.data}
            session={bootstrap.session}
            operations={operations}
            onLogout={() => {}}
            initialChannelId="channel-design"
            initialCallLayout="side-by-side"
            routeChannelId={routeChannelId}
            liveCallChannelId="channel-design"
            callStageRoom={storyRoom()}
          />
        </>
      );
    }

    await renderInRouter(<Routed />);
    expect(screen.getByLabelText(meetLabels.leave)).toBeInstanceOf(HTMLButtonElement);

    fireEvent.click(screen.getByText("go-random"));

    expect(screen.queryByLabelText(meetLabels.leave)).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("shows knock-wait chrome for an unmatched ad-hoc visit", async () => {
    const controller = createMeetStoryController(createRef<HTMLVideoElement | null>(), {
      inCall: false,
      status: "waiting",
      waitingForAdmission: true,
      peers: [],
    });
    const room = storyRoom();
    await renderWorkspace({
      unmatchedAdHocRoom: "aaaa-bbbb-cccc",
      callStageRoom: { ...room, controller },
    });

    expect(screen.getAllByText(meetLabels.knockWaitHint).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: meetLabels.cancelRequest })).toBeTruthy();
    expect(screen.queryByText(meetLabels.emptyChannelMain)).toBeNull();
    expect(document.querySelector(".meet-call-stage__dock")).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.devices })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.shareScreen })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.leave })).toBeNull();
  });
});
