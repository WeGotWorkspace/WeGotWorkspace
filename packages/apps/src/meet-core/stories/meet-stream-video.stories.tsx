import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetStreamVideo } from "@/meet-core/src/meet-stream-video";
import { meetStoryParameters, storyBooleanControl } from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type MeetStreamVideoStoryArgs = {
  hasStream: boolean;
  mirrored: boolean;
};

function MeetStreamVideoStory({ hasStream, mirrored }: MeetStreamVideoStoryArgs) {
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!hasStream) {
      setStream(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#171826";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#4f7cff";
    context.fillRect(40, 40, 400, 220);
    context.fillStyle = "#ffffff";
    context.font = "32px sans-serif";
    context.fillText("Remote video", 56, 120);
    const next = canvas.captureStream(24);
    setStream(next);
    return () => {
      next.getTracks().forEach((track) => track.stop());
    };
  }, [hasStream]);

  return (
    <MeetStoryScope variant="in-call">
      <div className="meet-workspace__screen-stage h-[min(70dvh,28rem)] w-full max-w-4xl">
        <MeetStreamVideo
          stream={stream}
          className="h-full w-full object-cover"
          mirrored={mirrored}
        />
      </div>
    </MeetStoryScope>
  );
}

const meta = {
  title: "Shared/Meet/Components/MeetStreamVideo",
  component: MeetStreamVideo,
  render: (args) => <MeetStreamVideoStory {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      snippet: `<MeetStreamVideo stream={remoteStream} className="h-full w-full object-cover" mirrored={false} />`,
    }),
  },
  argTypes: {
    hasStream: storyBooleanControl,
    mirrored: storyBooleanControl,
  },
} satisfies Meta<MeetStreamVideoStoryArgs>;

export default meta;
type Story = StoryObj<MeetStreamVideoStoryArgs>;

export const NoStream: Story = {
  name: "No stream",
  args: { hasStream: false, mirrored: false },
};

export const WithStream: Story = {
  name: "With stream",
  args: { hasStream: true, mirrored: false },
};

export const Mirrored: Story = {
  name: "Mirrored",
  args: { hasStream: true, mirrored: true },
};
