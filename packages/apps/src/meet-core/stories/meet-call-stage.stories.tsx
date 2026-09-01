import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MeetCallStage } from "@/meet-core/src/meet-call-stage";
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
 * Thin rail around `MeetRoomPane`. Stories stub Start/Join by toggling `callActive`
 * and fixture peers — no `useMeetRtc`.
 */
const meta = {
  title: "Apps/Meet/Components/MeetCallStage",
  component: MeetCallStage,
  render: (args) => <MeetCallStageStoryHarness {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Resizable / fullscreen call stage. Hides the old in-call chat drawer; chat is the sibling column.",
      snippet: `<MeetCallStage
  layout="side-by-side"
  chat={chatColumn}
  onLayoutChange={setLayout}
  controller={controller}
  displayName="Demo User"
  hasSignedInIdentity
  participantCount={3}
/>`,
    }),
  },
  argTypes: {
    layout: { control: "select", options: ["side-by-side", "fullscreen", "collapsed"] as const },
    callActive: storyBooleanControl,
    peerCount: storyNumberControl(0, 2),
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
    await expect(canvas.getByText("Chat will appear here.")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Show chat" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Expand call" }));
    await expect(canvas.getByRole("button", { name: "Show chat" })).toBeInTheDocument();
    await expect(canvas.queryByText("Chat will appear here.")).not.toBeInTheDocument();
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
    await expect(canvas.getByRole("button", { name: "Expand call" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Stop preview call" })).toBeInTheDocument();
  },
};
