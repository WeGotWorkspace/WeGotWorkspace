import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksRescueDialog, TasksRescueEntry } from "@/tasks-core/src/tasks-rescue-dialog";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const bootstrap = createTasksAppBootstrap();
const lists = bootstrap.data.taskLists;
const template = bootstrap.data.tasks[0]!;

let order = 0;

function parked(
  title: string,
  containerName: string,
  reason: ParkedTask["reason"] = "gone",
  kind: ParkedTask["kind"] = "create",
): ParkedTask {
  order += 1;
  const entityId = `story-task-${order}`;
  return {
    id: `tasks:${entityId}`,
    domain: "tasks",
    entityId,
    kind,
    reason,
    containerId: `list-${containerName}`,
    containerName,
    title,
    item: { ...template, id: entityId, title },
    parkedAt: order,
  };
}

const errands = [
  "Call the dentist",
  "Renew passport",
  "Book train tickets",
  "Pick up dry cleaning",
  "Pay the water bill",
  "Return library books",
  "Buy a birthday card for Sam",
  "Fix the bike light",
  "Order printer ink",
  "Schedule car service",
  "Cancel gym trial",
  "Send rent receipt to accountant",
  "Water the plants at the office",
  "Back up the laptop",
  "Reply to the school newsletter",
  "Replace the hallway bulb",
  "Book a table for Friday",
  "Update the home insurance",
  "Sort the recycling",
  "Buy coffee filters",
  "Check the tyre pressure",
  "Collect the parcel at the post office",
  "Plan the weekend trip",
  "Clean the fridge",
  "Text Mia about the keys",
];

/** Moving or discarding removes that list's tasks, as the app does. */
function Interactive(props: { writes: ParkedTask[] }) {
  const [writes, setWrites] = useState(props.writes);
  const [open, setOpen] = useState(true);
  const drop = (ids: string[]) =>
    setWrites((all) => all.filter((write) => !ids.includes(write.id)));
  const waitingLists = new Set(writes.map((write) => write.containerId)).size;
  return (
    <>
      <TasksRescueEntry
        lists={open ? 0 : waitingLists}
        labels={defaultTasksLabels}
        onOpen={() => setOpen(true)}
      />
      <TasksRescueDialog
        open={open && writes.length > 0}
        writes={writes}
        lists={lists}
        labels={defaultTasksLabels}
        onMove={drop}
        onDiscard={drop}
        onLater={() => setOpen(false)}
      />
    </>
  );
}

const meta: Meta<typeof Interactive> = {
  title: "Features/Tasks/Panes/Rescue dialog",
  component: Interactive,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <TasksStoryScope variant="main">
        <Story />
      </TasksStoryScope>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Interactive>;

/** One task added offline to a list that was deleted meanwhile. */
export const OneTaskListGone: Story = {
  args: { writes: [parked("Call the dentist", "Groceries")] },
};

/** A list that became view-only, with an edited task among the new ones. */
export const ViewOnlyWithEdits: Story = {
  args: {
    writes: [
      parked("Renew passport", "Team errands", "readOnly", "edit"),
      parked("Book train tickets", "Team errands", "readOnly"),
      parked("Order printer ink", "Team errands", "readOnly"),
    ],
  },
};

/** 25 tasks from one list: the dialog stays the same size. */
export const ManyTasks: Story = {
  args: {
    writes: errands.map((title, index) =>
      parked(title, "Household", "gone", index % 4 === 1 ? "edit" : "create"),
    ),
  },
};

/** Two lists: their dialogs follow each other. "Decide later" skips to the next. */
export const TwoLists: Story = {
  args: {
    writes: [
      parked("Call the dentist", "Groceries"),
      parked("Pay the water bill", "Groceries"),
      parked("Renew passport", "Team errands", "readOnly", "edit"),
      parked("Book train tickets", "Team errands", "readOnly"),
    ],
  },
};

/** While a move is running. */
export const Busy: StoryObj<typeof TasksRescueDialog> = {
  render: () => (
    <TasksRescueDialog
      open
      busy
      writes={[parked("Call the dentist", "Groceries")]}
      lists={lists}
      labels={defaultTasksLabels}
      onMove={() => undefined}
      onDiscard={() => undefined}
      onLater={() => undefined}
    />
  ),
};

/** The header button that reopens the dialog after "Decide later". */
export const EntryButton: StoryObj<typeof TasksRescueEntry> = {
  render: () => <TasksRescueEntry lists={2} labels={defaultTasksLabels} onOpen={() => undefined} />,
};
