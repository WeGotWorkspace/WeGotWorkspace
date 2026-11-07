import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { STORY_MEET_PEERS } from "@/meet-core/stories/meet-pane-stories.fixtures";
import { meetStoryParameters, storyBooleanControl } from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type MeetCallBarStoryArgs = {
  joined: boolean;
};

function MeetCallBarStory({ joined }: MeetCallBarStoryArgs) {
  return (
    <MeetStoryScope
      variant="split"
      className="meet-workspace--call-active flex h-auto min-h-0 flex-col justify-end p-6"
    >
      {/* As in the app: a block wrapper over the chat (the top dock), not a flex item. */}
      <div className="w-full self-start">
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
        />
      </div>
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
        "Pre-join call bar: the sticky list header (selection variant) over the top of the chat, with the meeting meta and who is already in the call. Join lives in the header; in-call controls on the expanded stage.",
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
  },
} satisfies Meta<MeetCallBarStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallBarStoryArgs>;

export const MeetingLive: Story = {
  name: "Meeting live",
  tags: ["vitest-ci"],
  args: {
    joined: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvasElement.querySelector<HTMLElement>(".meet-call-bar")!;
    await expect(canvas.queryByRole("button", { name: meetLabels.join })).not.toBeInTheDocument();
    // Text only: no camera or mic mark.
    await expect(bar.querySelector("svg.lucide")).toBeNull();
    // The sticky list header in its selection variant: the day rows' frost and
    // 36px row, tinted; text only, no camera or mic mark.
    await expect(bar.classList).toContain("list-sticky-header");
    await expect(bar.classList).toContain("list-sticky-header--selection");
    await expect(getComputedStyle(bar).backdropFilter).toContain("blur");
    await expect(bar.getBoundingClientRect().height).toBe(36);
    await expect(bar.querySelector("svg.lucide")).toBeNull();
    await expect(bar.querySelector(".list-sticky-header__emphasis")?.textContent).toBe(
      meetLabels.meetingStarted,
    );
    await expect(
      canvas.queryByRole("img", { name: "Demo User", hidden: true }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Alex Morgan", hidden: true }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "Jamie Lee", hidden: true })).toBeInTheDocument();
  },
};
