import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CloudOff, ListPlus } from "lucide-react";
import { createSharedTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import {
  NoticeBar,
  type Notice,
  type NoticeBarLabels,
  type NoticeBarVariant,
} from "@/notice-bar/src/notice-bar";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksRescueDialog } from "@/tasks-core/src/tasks-rescue-dialog";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { tasksStoryOperations } from "@/tasks-core/stories/tasks-story-shared";

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

/** The bar's own words. Like the dialog's, each app passes them in. */
const barLabels: NoticeBarLabels = {
  region: "Needs your attention",
  showDetails: "Show lists",
  hideDetails: "Hide lists",
  folded: (count) => `${count} things need you`,
  fold: "Fold",
};

/** Proposed Tasks copy for the rescue notice (new `TasksUILabels` entries once picked). */
const tasksCount = (count: number) => (count === 1 ? "1 task" : `${count} tasks`);
function rescueTitle(tasks: number, groups: { name: string }[]) {
  if (groups.length === 1) {
    return tasks === 1
      ? `A task from “${groups[0]!.name}” needs a new list`
      : `${tasks} tasks from “${groups[0]!.name}” need a new list`;
  }
  return `${tasksCount(tasks)} from ${groups.length} lists need a new list`;
}

type FrameProps = {
  variant: NoticeBarVariant;
  writes: ParkedTask[];
  withSyncNotice?: boolean;
  defaultOpen?: boolean;
};

/** Tasks with the bar in place of the header button. Review opens the real dialog. */
function Frame({ variant, writes: initial, withSyncNotice, defaultOpen }: FrameProps) {
  const [writes, setWrites] = useState(initial);
  const [open, setOpen] = useState<string[] | null>(null);
  const [syncStuck, setSyncStuck] = useState(Boolean(withSyncNotice));
  const groups = useMemo(() => {
    const byName = new Map<string, ParkedTask[]>();
    for (const write of writes) {
      byName.set(write.containerName, [...(byName.get(write.containerName) ?? []), write]);
    }
    return [...byName].map(([name, items]) => ({ name, items }));
  }, [writes]);
  const drop = (ids: string[]) => setWrites((all) => all.filter((w) => !ids.includes(w.id)));

  const notices: Notice[] = [];
  if (syncStuck) {
    notices.push({
      id: "sync",
      tone: "error",
      icon: <CloudOff aria-hidden />,
      title: "Some changes couldn’t sync. They’re saved on this device.",
      short: "Changes not synced",
      actionLabel: "Retry",
      onAction: () => setSyncStuck(false),
    });
  }
  if (groups.length > 0) {
    notices.push({
      id: "rescue",
      tone: "warning",
      icon: <ListPlus aria-hidden />,
      title: rescueTitle(writes.length, groups),
      short: `${tasksCount(writes.length)} need a list`,
      actionLabel: "Review",
      onAction: () => setOpen(writes.map((w) => w.id)),
      items: groups.map((group) => ({
        id: group.name,
        label: `“${group.name}”`,
        meta: tasksCount(group.items.length),
        onAction: () => setOpen(group.items.map((w) => w.id)),
      })),
    });
  }
  const shown = open ? writes.filter((w) => open.includes(w.id)) : [];

  return (
    <>
      <TasksWorkspace
        {...bootstrap}
        operations={tasksStoryOperations}
        notice={
          <NoticeBar
            notices={notices}
            labels={barLabels}
            variant={variant}
            itemActionLabel="Review"
            defaultOpen={defaultOpen}
          />
        }
      />
      <TasksRescueDialog
        open={shown.length > 0}
        writes={shown}
        lists={lists}
        labels={defaultTasksLabels}
        onMove={drop}
        onDiscard={drop}
        onLater={() => setOpen(null)}
      />
    </>
  );
}

const meta: Meta<typeof Frame> = {
  title: "Features/Rescue/Notice bar options",
  component: Frame,
  parameters: {
    layout: "fullscreen",
    // The app switcher reads the path; the preview default is /notes.
    routerPath: "/tasks",
    docs: {
      description: {
        component:
          "Replaces the “Tasks from 2 lists need a new list” header button. Three options to compare: A (one line under the header), B (the same, with a row per list), C (docked at the bottom, folds to a pill). None can be dismissed while tasks wait. Review opens the rescue dialog.",
      },
    },
  },
  args: { writes: TWO_LISTS },
};

export default meta;
type Story = StoryObj<typeof Frame>;

const phone = { viewport: { value: "phone375", isRotated: false } };

/** A · one line under the header: what waits, and Review. */
export const AStripOneList: Story = {
  name: "A · Strip · one list",
  args: { variant: "strip", writes: ONE_LIST },
};

export const AStripTwoLists: Story = {
  name: "A · Strip · two lists",
  args: { variant: "strip" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByRole("region", { name: "Needs your attention" });
    await expect(bar).toHaveTextContent("3 tasks from 2 lists need a new list");
    await userEvent.click(within(bar).getByRole("button", { name: "Review" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("List 1 of 2")).toBeVisible();
  },
};

export const AStripPhone: Story = {
  name: "A · Strip · phone",
  args: { variant: "strip" },
  globals: phone,
};

/** B · the strip, plus a row per list so you can open one list directly. */
export const BExpandableClosed: Story = {
  name: "B · Expandable · closed",
  args: { variant: "expandable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("button", { name: "Show lists" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await expect(canvas.getByRole("button", { name: "Hide lists" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(canvas.getByText("“Repairs”")).toBeVisible();
  },
};

export const BExpandableOpen: Story = {
  name: "B · Expandable · open",
  args: { variant: "expandable", defaultOpen: true },
};

export const BExpandablePhone: Story = {
  name: "B · Expandable · phone, open",
  args: { variant: "expandable", defaultOpen: true },
  globals: phone,
};

/** C · docked at the bottom of the pane, in thumb reach; folds to a pill but never goes away. */
export const CDock: Story = {
  name: "C · Dock",
  args: { variant: "dock" },
};

export const CDockPhone: Story = {
  name: "C · Dock · phone",
  args: { variant: "dock" },
  globals: phone,
};

export const CDockFoldedPhone: Story = {
  name: "C · Dock · phone, folded",
  args: { variant: "dock", defaultOpen: false },
  globals: phone,
};

/**
 * Question for Wouter: should the “not synced” notice (today a sticky toast in
 * Notes, Contacts, Docs and Drive) move into the same bar? Tasks has no such
 * notice today; the copy here is Notes’.
 */
export const WithSyncNotice: Story = {
  name: "Question · Strip with the sync notice too",
  args: { variant: "strip", withSyncNotice: true },
};

export const WithSyncNoticePhone: Story = {
  name: "Question · Strip with the sync notice too · phone",
  args: { variant: "strip", withSyncNotice: true },
  globals: phone,
};
