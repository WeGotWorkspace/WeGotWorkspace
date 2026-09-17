import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  STORY_MEET_DEVICES,
  STORY_MEET_KNOCKERS,
  STORY_MEET_MICROPHONES,
  STORY_MEET_PEERS,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
} from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";
import { useState } from "react";

type MeetCallBarStoryArgs = {
  joined: boolean;
  micOn: boolean;
  videoOn: boolean;
  invite: "join" | null;
  audioOnly: boolean;
  showKnockers: boolean;
};

function MeetCallBarStory({
  joined,
  micOn,
  videoOn,
  invite,
  audioOnly,
  showKnockers,
}: MeetCallBarStoryArgs) {
  const [camera, setCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [microphone, setMicrophone] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const [speaker, setSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  const [mic, setMic] = useState(micOn);
  const [video, setVideo] = useState(videoOn);

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
        micOn={mic}
        videoOn={video}
        cameras={STORY_MEET_DEVICES}
        microphones={STORY_MEET_MICROPHONES}
        speakers={STORY_MEET_SPEAKERS}
        activeCamera={camera}
        activeMic={microphone}
        activeSpeaker={speaker}
        onToggleMic={() => setMic((value) => !value)}
        onToggleVideo={() => setVideo((value) => !value)}
        onCameraChange={setCamera}
        onMicrophoneChange={setMicrophone}
        onSpeakerChange={setSpeaker}
        onExpand={STORY_NOOP}
        onLeave={STORY_NOOP}
        onMuteParticipant={STORY_NOOP}
        joined={joined}
        invite={invite}
        audioOnly={audioOnly}
        onInvite={invite ? STORY_NOOP : undefined}
        knockers={showKnockers ? STORY_MEET_KNOCKERS : []}
        onAdmitKnocker={showKnockers ? STORY_NOOP : undefined}
        onDenyKnocker={showKnockers ? STORY_NOOP : undefined}
      />
    </MeetStoryScope>
  );
}

const meta = {
  title: "Apps/Meet/Components/MeetCallBar",
  component: MeetCallBar,
  render: (args) => <MeetCallBarStory {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Compact in-channel call chrome: meeting meta, avatar roster, mic/video/devices, expand, and leave.",
      snippet: `<MeetCallBar
  elapsedLabel="02:14"
  selfId="self"
  selfName="Demo User"
  peers={peers}
  participantCount={3}
  micOn
  videoOn
  joined
  onExpand={expand}
  onLeave={leave}
/>`,
    }),
  },
  argTypes: {
    joined: storyBooleanControl,
    micOn: storyBooleanControl,
    videoOn: storyBooleanControl,
    invite: { control: "select", options: [null, "join"] as const },
    audioOnly: storyBooleanControl,
    showKnockers: storyBooleanControl,
  },
} satisfies Meta<MeetCallBarStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallBarStoryArgs>;

export const Joined: Story = {
  tags: ["vitest-ci"],
  args: {
    joined: true,
    micOn: true,
    videoOn: true,
    invite: null,
    audioOnly: false,
    showKnockers: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: meetLabels.expandCall })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.leave })).toBeInTheDocument();
    const muteControls = canvas.getAllByRole("button", { name: meetLabels.disableAudio });
    await userEvent.click(muteControls[0]!);
    await expect(
      canvas.getAllByRole("button", { name: meetLabels.enableAudio }).length,
    ).toBeGreaterThan(0);
  },
};

export const InviteToJoin: Story = {
  name: "Invite to join",
  args: {
    joined: false,
    micOn: true,
    videoOn: false,
    invite: "join",
    audioOnly: false,
    showKnockers: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const join = canvas.getByRole("button", { name: meetLabels.join });
    await expect(join).toBeInTheDocument();
    await expect(join.querySelector(".lucide-video")).toBeTruthy();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.expandCall }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("img", { name: "Demo User avatar" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "Alex Morgan avatar" })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: "Jamie Lee avatar" })).toBeInTheDocument();
  },
};

export const InviteToJoinAudioOnly: Story = {
  name: "Invite to join (audio only)",
  args: {
    joined: false,
    micOn: true,
    videoOn: false,
    invite: "join",
    audioOnly: true,
    showKnockers: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const join = canvas.getByRole("button", { name: meetLabels.join });
    await expect(join).toBeInTheDocument();
    await expect(join.querySelector(".lucide-mic")).toBeTruthy();
    await expect(join.querySelector(".lucide-video")).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.expandCall }),
    ).not.toBeInTheDocument();
  },
};

export const WaitingToJoin: Story = {
  name: "Waiting to join",
  args: {
    joined: true,
    micOn: true,
    videoOn: true,
    invite: null,
    audioOnly: false,
    showKnockers: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: meetLabels.waitingToJoin(2) });
    await expect(trigger).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.expandCall })).toBeInTheDocument();
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      body.getByRole("button", { name: meetLabels.admitName("Alex Morgan") }),
    ).toBeInTheDocument();
    const popover = canvasElement.ownerDocument.body.querySelector(".meet-knock-badge__popover");
    await expect(popover).toBeTruthy();
    await expect(popover?.className).not.toMatch(/meet-popover-surface/);
  },
};
