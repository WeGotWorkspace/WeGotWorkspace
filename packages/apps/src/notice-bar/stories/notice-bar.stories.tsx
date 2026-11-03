import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { createSharedTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { rescueNotice } from "@/rescue-ui/rescue-notice";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import { TasksRescueDialog } from "@/tasks-core/src/tasks-rescue-dialog";
import { tasksRescueView } from "@/tasks-core/src/tasks-rescue-view";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { tasksStoryOperations } from "@/tasks-core/stories/tasks-story-shared";
import { tasksSyncNotice } from "@/tasks-core/src/use-tasks-sync-notice";

const bootstrap = createSharedTasksAppBootstrap();
const lists = bootstrap.data.taskLists;
const template = bootstrap.data.tasks[0]!;

let order = 0;
function parked(title: string, containerName: string): ParkedTask {
  order += 1;
  const entityId = `notice-task-${order}`;
  return {
    id: `tasks:${entityId}`,
    domain: "tasks",
    entityId,
    kind: "create",
    reason: "gone",
    containerId: `list-${containerName}`,
    containerName,
    title,
    item: { ...template, id: entityId, title },
    parkedAt: order,
  };
}

const ONE_LIST = [parked("Buy stamps", "Groceries")];
const TWO_LISTS = [
  parked("Buy stamps", "Groceries"),
  parked("Oat milk", "Groceries"),
  parked("Call the plumber", "Repairs"),
];

type FrameProps = { writes: ParkedTask[]; syncStuck?: boolean };

/** Tasks with the bar under the header, as the app renders it. Review opens the real dialog. */
function Frame({ writes: initial, syncStuck: initialStuck = false }: FrameProps) {
  const [writes, setWrites] = useState(initial);
  const [open, setOpen] = useState(false);
  const [syncStuck, setSyncStuck] = useState(initialStuck);
  const drop = (ids: string[]) => setWrites((all) => all.filter((w) => !ids.includes(w.id)));
  return (
    <>
      <TasksWorkspace
        {...bootstrap}
        operations={tasksStoryOperations}
        notice={
          <NoticeBar
            label={L.noticeBarLabel}
            notices={[
              syncStuck ? tasksSyncNotice(L, () => setSyncStuck(false)) : null,
              rescueNotice("tasks", tasksRescueView(L), writes, () => setOpen(true)),
            ]}
          />
        }
      />
      <TasksRescueDialog
        open={open && writes.length > 0}
        writes={writes}
        lists={lists}
        labels={L}
        onMove={drop}
        onDiscard={drop}
        onLater={() => setOpen(false)}
      />
    </>
  );
}

const meta: Meta<typeof Frame> = {
  title: "UI/Notice bar",
  component: Frame,
  tags: ["vitest-ci"],
  parameters: {
    layout: "fullscreen",
    // The app switcher reads the path; the preview default is /notes.
    routerPath: "/tasks",
    docs: {
      description: {
        component:
          "One line per notice between the header and the content (#1894): changes that could not sync on top, tasks that need a new list below. A notice cannot be dismissed; it goes away when what it reports is resolved.",
      },
    },
  },
  args: { writes: TWO_LISTS },
};

export default meta;
type Story = StoryObj<typeof Frame>;

const phone = { viewport: { value: "phone375", isRotated: false } };

export const OneList: Story = {
  args: { writes: ONE_LIST },
};

export const TwoLists: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByRole("region", { name: L.noticeBarLabel });
    await expect(bar).toHaveTextContent("3 tasks from 2 lists need a new list");
    await userEvent.click(within(bar).getByRole("button", { name: L.rescueReview }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("List 1 of 2")).toBeVisible();
    await userEvent.click(body.getByRole("button", { name: "Discard 2 tasks" }));
    await userEvent.click(await body.findByRole("button", { name: "Discard task" }));
    await expect(canvas.queryByRole("region", { name: L.noticeBarLabel })).toBeNull();
  },
};

export const TwoListsPhone: Story = {
  globals: phone,
};

export const SyncAndRescue: Story = {
  args: { syncStuck: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByRole("region", { name: L.noticeBarLabel });
    const buttons = within(bar).getAllByRole("button");
    await expect(buttons.map((b) => b.textContent)).toEqual([L.retrySync, L.rescueReview]);
    await userEvent.click(buttons[0]!);
    await expect(bar).not.toHaveTextContent(L.syncFailedNotice);
  },
};

export const SyncAndRescuePhone: Story = {
  args: { syncStuck: true },
  globals: phone,
};

export const SyncOnly: Story = {
  args: { writes: [], syncStuck: true },
};
