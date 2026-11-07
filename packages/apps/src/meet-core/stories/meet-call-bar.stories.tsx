import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { STORY_MEET_PEERS } from "@/meet-core/stories/meet-pane-stories.fixtures";
import { meetStoryParameters, storyBooleanControl } from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type MeetCallBarStoryArgs = {
  joined: boolean;
  audioOnly: boolean;
};

function MeetCallBarStory({ joined, audioOnly }: MeetCallBarStoryArgs) {
  return (
    <MeetStoryScope
      variant="split"
      className="meet-workspace--call-active flex h-auto min-h-0 flex-col justify-end p-6"
    >
      <MeetCallBar
        elapsedLabel="02:14"
        selfId="self"
        selfName="Demo User"
        peers={STORY_MEET_PEERS.map((peer) => ({
          id: peer.id,
          name: peer.name,
          stream: null,
          remoteMedia: peer.remoteMedia,
        }))}
        participantCount={joined ? 1 + STORY_MEET_PEERS.length : STORY_MEET_PEERS.length}
        joined={joined}
        audioOnly={audioOnly}
      />
    </MeetStoryScope>
  );
}

const meta = {
  title: "Features/Meet/Components/MeetCallBar",
  component: MeetCallBar,
  render: (args) => <MeetCallBarStory {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Pre-join call bar: a frosted card with the meeting meta and who is already in the call. Join lives in the header; in-call controls on the expanded stage.",
      snippet: `<MeetCallBar
  elapsedLabel="02:14"
  selfId="self"
  selfName="Demo User"
  peers={peers}
  participantCount={2}
/>`,
    }),
  },
  argTypes: {
    joined: storyBooleanControl,
    audioOnly: storyBooleanControl,
  },
} satisfies Meta<MeetCallBarStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallBarStoryArgs>;

export const MeetingLive: Story = {
  name: "Meeting live",
  tags: ["vitest-ci"],
  args: {
    joined: false,
    audioOnly: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvasElement.querySelector<HTMLElement>(".meet-call-bar")!;
    await expect(canvas.queryByRole("button", { name: meetLabels.join })).not.toBeInTheDocument();
    await expect(bar.querySelector(".lucide-video")).toBeTruthy();
    // Frosted floating card, no edge line.
    await expect(getComputedStyle(bar).backdropFilter).toContain("blur");
    await expect(getComputedStyle(bar).borderBottomWidth).toBe("0px");
    await expect(
      canvas.queryByRole("img", { name: "Demo User", hidden: true }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Alex Morgan", hidden: true }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "Jamie Lee", hidden: true })).toBeInTheDocument();
  },
};

export const MeetingLiveAudioOnly: Story = {
  name: "Meeting live (audio only)",
  tags: ["vitest-ci"],
  args: {
    joined: false,
    audioOnly: true,
  },
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector<HTMLElement>(".meet-call-bar")!;
    await expect(bar.querySelector(".lucide-mic")).toBeTruthy();
    await expect(bar.querySelector(".lucide-video")).toBeNull();
  },
};
