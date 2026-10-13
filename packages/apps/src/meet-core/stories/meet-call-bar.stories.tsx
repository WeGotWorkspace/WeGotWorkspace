import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { STORY_MEET_PEERS } from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
} from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type MeetCallBarStoryArgs = {
  joined: boolean;
  invite: "join" | null;
  audioOnly: boolean;
};

function MeetCallBarStory({ joined, invite, audioOnly }: MeetCallBarStoryArgs) {
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
        invite={invite}
        audioOnly={audioOnly}
        onInvite={invite ? STORY_NOOP : undefined}
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
        "Pre-join call bar: meeting meta, who is already in the call, and a Join button. In-call controls live on the expanded stage.",
      snippet: `<MeetCallBar
  elapsedLabel="02:14"
  selfId="self"
  selfName="Demo User"
  peers={peers}
  participantCount={2}
  invite="join"
  onInvite={join}
/>`,
    }),
  },
  argTypes: {
    joined: storyBooleanControl,
    invite: { control: "select", options: [null, "join"] as const },
    audioOnly: storyBooleanControl,
  },
} satisfies Meta<MeetCallBarStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallBarStoryArgs>;

export const InviteToJoin: Story = {
  name: "Invite to join",
  tags: ["vitest-ci"],
  args: {
    joined: false,
    invite: "join",
    audioOnly: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const join = canvas.getByRole("button", { name: meetLabels.join });
    await expect(join).toBeInTheDocument();
    await expect(join.className).toContain("button--variant-primary");
    await expect(join.className).not.toContain("button--severity-success");
    await expect(join.querySelector(".lucide-video")).toBeTruthy();
    await expect(
      canvas.queryByRole("img", { name: "Demo User", hidden: true }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Alex Morgan", hidden: true }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "Jamie Lee", hidden: true })).toBeInTheDocument();
  },
};

export const InviteToJoinAudioOnly: Story = {
  name: "Invite to join (audio only)",
  tags: ["vitest-ci"],
  args: {
    joined: false,
    invite: "join",
    audioOnly: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const join = canvas.getByRole("button", { name: meetLabels.join });
    await expect(join).toBeInTheDocument();
    await expect(join.querySelector(".lucide-mic")).toBeTruthy();
    await expect(join.querySelector(".lucide-video")).toBeNull();
  },
};
