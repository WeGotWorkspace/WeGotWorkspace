import { useEffect, useRef } from "react";
import { MeetSelfPreviewPiP } from "@/meet-core/src/meet-self-preview-pip";
import { STORY_NOOP } from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

export type MeetSelfPreviewPiPStoryArgs = {
  name: string;
  videoOn: boolean;
  micOn: boolean;
};

export function MeetSelfPreviewPiPStory({ name, videoOn, micOn }: MeetSelfPreviewPiPStoryArgs) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoOn || typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#20223a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#4f7cff";
    context.font = "24px sans-serif";
    context.fillText("Camera preview", 24, 48);
    const stream = canvas.captureStream(15);
    const node = videoRef.current;
    if (node) node.srcObject = stream;
    return () => {
      stream.getTracks().forEach((track) => track.stop());
      if (node) node.srcObject = null;
    };
  }, [videoOn]);

  return (
    <MeetStoryScope variant="pip-stage">
      <MeetSelfPreviewPiP
        name={name}
        videoOn={videoOn}
        micOn={micOn}
        videoRef={videoRef}
        onInfo={STORY_NOOP}
        onError={STORY_NOOP}
      />
    </MeetStoryScope>
  );
}
