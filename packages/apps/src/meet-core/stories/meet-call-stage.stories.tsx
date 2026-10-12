import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MeetCallStage } from "@/meet-core/src/meet-call-stage";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  MeetCallStageStoryHarness,
  type MeetCallStageStoryArgs,
} from "@/meet-core/stories/meet-call-stage.stories.harness";
import {
  meetStoryParameters,
  storyBooleanControl,
  storyNumberControl,
} from "@/meet-core/stories/meet-story-shared";

/**
 * Expanded call chrome around `MeetCallExpanded`. Stories stub Start/Join by
 * toggling `callActive` and fixture peers — no `useMeetRtc`.
 */
const meta = {
  title: "Features/Meet/Components/MeetCallStage",
  component: MeetCallStage,
  render: (args) => <MeetCallStageStoryHarness {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Expanded call chrome: light stage, peer grid or filmstrip, and a chat panel. Starting a call opens the stage. There is no collapse toggle.",
      snippet: `<MeetCallStage
  layout="fullscreen"
  channelTitle="#design"
  chat={chatColumn}
  onLayoutChange={setLayout}
  controller={controller}
  displayName="Demo User"
  hasSignedInIdentity
  participantCount={4}
/>`,
    }),
  },
  argTypes: {
    layout: {
      control: "select",
      options: ["compact", "side-by-side", "fullscreen", "collapsed"],
    },
    callActive: storyBooleanControl,
    peerCount: storyNumberControl(0, 2),
    screenShare: storyBooleanControl,
  },
} satisfies Meta<MeetCallStageStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallStageStoryArgs>;

export const SideBySide: Story = {
  name: "Side by side",
  tags: ["vitest-ci"],
  args: {
    layout: "side-by-side",
    callActive: true,
    peerCount: 2,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Chat will appear here.").length).toBeGreaterThan(0);
    await expect(canvas.queryByRole("button", { name: "Collapse call" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("button", { name: "Hide chat" }).length).toBeGreaterThan(0);
    await expect(canvas.queryByLabelText("Resize call stage")).not.toBeInTheDocument();
    await userEvent.click(canvas.getAllByRole("button", { name: "Hide chat" })[0]!);
    await expect(canvas.getAllByRole("button", { name: "Show chat" }).length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Chat will appear here.").length).toBeGreaterThan(0);
  },
};

export const ChatPanelClosed: Story = {
  name: "Chat panel closed",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
    defaultChatOpen: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button", { name: "Show chat" }).length).toBeGreaterThan(0);
    await userEvent.click(canvas.getAllByRole("button", { name: "Show chat" })[0]!);
    await expect(canvas.getAllByRole("button", { name: "Hide chat" }).length).toBeGreaterThan(0);
  },
};

export const NarrowOverlay: Story = {
  name: "Narrow overlay",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
    defaultChatOpen: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 390, height: 844, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrim = canvasElement.querySelector(".workspace-app-layout__panel-scrim");
    await expect(scrim).toBeTruthy();
    await userEvent.click(scrim as Element);
    await expect(canvas.getAllByRole("button", { name: "Show chat" }).length).toBeGreaterThan(0);
    expect(canvasElement.querySelector(".workspace-app-layout__panel-scrim")).toBeNull();
  },
};

export const MediumOverlay: Story = {
  name: "Medium overlay",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
    defaultChatOpen: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 900, height: 700, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
};

export const WideFlex: Story = {
  name: "Wide flex",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
    defaultChatOpen: true,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1280, height: 800, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button", { name: "Hide chat" }).length).toBeGreaterThan(0);
  },
};

export const ScreenShare: Story = {
  name: "Screen share",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
    defaultChatOpen: false,
    screenShare: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filmstrip = canvasElement.querySelector(".meet-call-stage__share-peers");
    await expect(filmstrip).toBeTruthy();
    await expect(canvasElement.querySelector(".meet-call-stage__share-main")).toBeTruthy();
    const peers = within(filmstrip as HTMLElement);
    await expect(peers.getByText("Demo User")).toBeInTheDocument();
    await expect(peers.getByText("Alex Morgan")).toBeInTheDocument();
    await expect(peers.getByText("Jamie Lee")).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.sharingScreen)).toBeInTheDocument();
  },
};

export const PinnedPeer: Story = {
  name: "Pinned peer",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
    defaultChatOpen: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: meetLabels.pinParticipant("Alex Morgan") }),
    );
    await expect(canvasElement.querySelector("[data-featured='pin']")).toBeTruthy();
    const main = canvasElement.querySelector(".meet-call-stage__share-main");
    await expect(main?.querySelector(".meet-peer-tile__display-name")).toBeNull();
    await expect(main?.querySelector(".meet-peer-tile__name")?.textContent).toBe("Alex Morgan");
    const filmstrip = canvasElement.querySelector(".meet-call-stage__share-peers");
    await expect(filmstrip?.textContent).toContain("Alex Morgan");
    await expect(filmstrip?.textContent).toContain("Demo User");
    await expect(filmstrip?.querySelector(".meet-peer-tile__display-name")).toBeNull();
    await expect(filmstrip?.textContent).toContain("Demo User");
    await expect(
      canvas.queryByRole("button", { name: meetLabels.unpinParticipant("Jamie Lee") }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getAllByRole("button", { name: meetLabels.pinParticipant("Jamie Lee") })[0]!,
    );
    await expect(
      canvas.queryByRole("button", { name: meetLabels.unpinParticipant("Alex Morgan") }),
    ).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector(".meet-call-stage__share-main")?.textContent,
    ).toContain("Jamie Lee");

    await userEvent.click(
      canvas.getAllByRole("button", { name: meetLabels.unpinParticipant("Jamie Lee") })[0]!,
    );
    await expect(canvasElement.querySelector(".meet-call-stage__share")).toBeNull();
    await expect(canvasElement.querySelector(".meet-call-stage__grid")).toBeTruthy();
  },
};

export const Fullscreen: Story = {
  name: "Fullscreen",
  args: {
    layout: "fullscreen",
    callActive: true,
    peerCount: 2,
  },
};

export const Collapsed: Story = {
  name: "Collapsed",
  args: {
    layout: "collapsed",
    callActive: false,
    peerCount: 2,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Start call" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Start call" }));
    await expect(canvas.queryByRole("button", { name: "Collapse call" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Stop preview call" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
  },
};
