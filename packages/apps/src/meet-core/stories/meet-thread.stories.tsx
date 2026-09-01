import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import {
  THREAD_PARENT,
  THREAD_REPLIES,
} from "@/chat-ui/stories/chat-thread-panel.stories.fixtures";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import type { MeetThreadCallLayout } from "@/meet-core/src/meet-thread-placement";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { ChatMessage } from "@/meet-core/src/meet-types";

function CallStagePlaceholder() {
  return (
    <div className="meet-call-stage meet-call-stage--split">
      <div className="meet-call-split__group">
        <div className="meet-call-split__chat">
          <div className="meet-call-stage__chat-placeholder">
            {meetLabels.chatColumnPlaceholder}
          </div>
        </div>
        <div className="meet-call-split__stage">
          <div className="meet-call-stage__chat-placeholder">Call stage</div>
        </div>
      </div>
    </div>
  );
}

function MeetThreadPlacementHarness({ callLayout }: { callLayout: MeetThreadCallLayout }) {
  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  const [threadOpen, setThreadOpen] = useState(true);
  const parent = THREAD_PARENT as ChatMessage;
  const replies = THREAD_REPLIES as ChatMessage[];
  const callActive = callLayout !== "none";

  return (
    <MeetWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      callLayout={callLayout}
      callActive={callActive}
      callStage={callActive ? <CallStagePlaceholder /> : undefined}
      chatColumn={
        <div className="meet-call-stage__chat-placeholder">{meetLabels.chatColumnPlaceholder}</div>
      }
      threadOpen={threadOpen}
      threadMessage={parent}
      threadReplies={replies}
      onCloseThread={() => setThreadOpen(false)}
      onOpenThread={() => setThreadOpen(true)}
    />
  );
}

const meta = {
  title: "Apps/Meet/Panes/MeetThread",
  component: MeetWorkspace,
  parameters: {
    layout: "fullscreen",
    routerPath: "/meet",
    docs: {
      description: {
        component:
          "Thread placement only: workspace `panel` when idle, SideDrawer over the chat column while a call uses the right rail. Chunk F wires ChatMessageList as main.",
      },
    },
  },
} satisfies Meta<typeof MeetWorkspace>;

export default meta;
type Story = StoryObj<typeof MeetWorkspace>;

export const IdlePanel: Story = {
  name: "Idle panel",
  render: () => <MeetThreadPlacementHarness callLayout="none" />,
};

export const CallDrawer: Story = {
  name: "Call drawer",
  render: () => <MeetThreadPlacementHarness callLayout="split" />,
};

export const CallFullscreenDrawer: Story = {
  name: "Call fullscreen drawer",
  render: () => <MeetThreadPlacementHarness callLayout="fullscreen" />,
};
