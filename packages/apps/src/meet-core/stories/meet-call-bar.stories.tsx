import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  STORY_MEET_DEVICES,
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
};

function MeetCallBarStory({ joined, micOn, videoOn, invite, audioOnly }: MeetCallBarStoryArgs) {
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
    micOn: storyBooleanControl,
    videoOn: storyBooleanControl,
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
    micOn: true,
    videoOn: false,
    invite: "join",
    audioOnly: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const join = canvas.getByRole("button", { name: meetLabels.join });
    await expect(join).toBeInTheDocument();
    await expect(join.className).toContain("button--severity-success");
    await expect(join.querySelector(".lucide-video")).toBeTruthy();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.expandCall }),
    ).not.toBeInTheDocument();
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
    micOn: true,
    videoOn: false,
    invite: "join",
    audioOnly: true,
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
