import { createRef, useState, type ComponentProps, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      initialCallLayout="compact"
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

  it("hides joined chrome after switching to another channel and does not hang up", async () => {
    const { leaveCall } = await renderWorkspace();

    expect(screen.getByRole("button", { name: meetLabels.leave })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.devices })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /# random/i }));

    expect(screen.queryByRole("button", { name: meetLabels.leave })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.devices })).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(screen.getByRole("button", { name: /^Meet$/ })).toBeTruthy();
    expect(leaveCall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /# design/i }));

    expect(screen.getByRole("button", { name: meetLabels.leave })).toBeTruthy();
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("hides joined chrome after switching to a DM and does not hang up", async () => {
    const { leaveCall } = await renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/i }));

    expect(screen.queryByRole("button", { name: meetLabels.leave })).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("does not paint the live call's chrome on a different open conversation", async () => {
    const { leaveCall } = await renderWorkspace({
      initialChannelId: "channel-random",
      initialCallLayout: "compact",
      routeChannelId: "channel-random",
      liveCallChannelId: "channel-design",
    });

    expect(screen.queryByRole("button", { name: meetLabels.leave })).toBeNull();
    expect(screen.queryByRole("button", { name: meetLabels.devices })).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(screen.getByRole("heading", { name: "#random" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /# design/i }));

    expect(screen.getByRole("button", { name: meetLabels.leave })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.devices })).toBeTruthy();
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
            initialCallLayout="compact"
            routeChannelId={routeChannelId}
            liveCallChannelId="channel-design"
            callStageRoom={storyRoom()}
          />
        </>
      );
    }

    await renderInRouter(<Routed />);
    expect(screen.getByRole("button", { name: meetLabels.leave })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "go-random" }));

    expect(screen.queryByRole("button", { name: meetLabels.leave })).toBeNull();
    expect(screen.queryByText(meetLabels.meetingStarted)).toBeNull();
    expect(leaveCall).not.toHaveBeenCalled();
  });
});
