import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { expect, within } from "storybook/test";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
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
    <div className="meet-call-stage meet-call-stage--expanded">
      <div className="meet-call-stage__chrome">
        <p className="meet-call-stage__title">Call stage</p>
      </div>
    </div>
  );
}

function MeetThreadPlacementHarness({ callLayout }: { callLayout: MeetThreadCallLayout }) {
  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  const [threadOpen, setThreadOpen] = useState(true);
  const parent = {
    ...THREAD_PARENT,
    authorId: "demo.user",
    authorName: "Demo User",
  } as ChatMessage;
  const replies = THREAD_REPLIES as ChatMessage[];
  const callActive = callLayout !== "none";

  return (
    <MeetWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      callLayout={callLayout}
      callActive={callActive}
      callChannelId={bootstrap.data.channels?.[0]?.id}
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
          "Thread and in-call chat share one workspace right rail. Contents swap; there is no second drawer.",
      },
    },
  },
} satisfies Meta<typeof MeetWorkspace>;

export default meta;
type Story = StoryObj<typeof MeetWorkspace>;

export const IdlePanel: Story = {
  name: "Idle panel",
  render: () => <MeetThreadPlacementHarness callLayout="none" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reply = canvas.getByText("I left comments on the first two sections.");
    const panel = reply.closest(".chat-thread-panel");
    await expect(panel).toBeTruthy();
    await expect(
      within(panel as HTMLElement).queryByRole("button", { name: (n) => n === chatUiLabels.edit }),
    ).not.toBeInTheDocument();
    const headerEdit = canvas.getByRole("button", { name: (n) => n === chatUiLabels.edit });
    await expect(headerEdit).toBeInTheDocument();
    await expect(headerEdit.closest(".docs-collab-sidebar-panel__header")).toBeTruthy();
    const people = canvas.getByLabelText(meetLabels.threadPeopleCount(2));
    await expect(people).toBeInTheDocument();
    await expect(people.closest(".docs-collab-sidebar-panel__header-actions")).toBeTruthy();
    const actions = people.closest(".docs-collab-sidebar-panel__header-actions");
    expect(actions).toBeTruthy();
    const actionChildren = [...(actions as HTMLElement).children];
    expect(actionChildren.indexOf(people)).toBeLessThan(actionChildren.indexOf(headerEdit));
    expect(actionChildren.at(-1)?.getAttribute("aria-label")).toBe(meetLabels.threadClose);
  },
};

export const CallDrawer: Story = {
  name: "Call rail",
  render: () => <MeetThreadPlacementHarness callLayout="split" />,
};

export const CallFullscreenDrawer: Story = {
  name: "Call fullscreen rail",
  render: () => <MeetThreadPlacementHarness callLayout="fullscreen" />,
};
