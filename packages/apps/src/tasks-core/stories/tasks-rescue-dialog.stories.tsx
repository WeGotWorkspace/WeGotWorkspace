import type { Meta, StoryObj } from "@storybook/react-vite";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { ParkedTask } from "@/lib/offline/tasks/tasks-parked-writes";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksRescueDialog, TasksRescueEntry } from "@/tasks-core/src/tasks-rescue-dialog";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const bootstrap = createTasksAppBootstrap();
const lists = bootstrap.data.taskLists;

function parked(
  index: number,
  title: string,
  kind: ParkedTask["kind"],
  reason: ParkedTask["reason"],
  containerName: string,
): ParkedTask {
  const item = { ...bootstrap.data.tasks[index]!, title };
  return {
    id: `tasks:${item.id}`,
    domain: "tasks",
    entityId: item.id,
    kind,
    reason,
    containerId: `list-${containerName}`,
    containerName,
    title,
    item,
    parkedAt: 1,
  };
}

const meta: Meta<typeof TasksRescueDialog> = {
  title: "Features/Tasks/Panes/Rescue dialog",
  component: TasksRescueDialog,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <TasksStoryScope variant="main">
        <Story />
      </TasksStoryScope>
    ),
  ],
  args: {
    open: true,
    lists,
    labels: defaultTasksLabels,
    onMove: () => undefined,
    onDiscard: () => undefined,
    onLater: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof TasksRescueDialog>;

/** A task added offline to a list that was deleted meanwhile. */
export const OneCreateListGone: Story = {
  args: { writes: [parked(0, "Call the dentist", "create", "gone", "Groceries")] },
};

/** An offline edit to a task in a list that became view-only. */
export const OneEditViewOnly: Story = {
  args: { writes: [parked(1, "Renew passport", "edit", "readOnly", "Team errands")] },
};

/** Several tasks from one list: the new-list name is suggested from it. */
export const SeveralFromOneList: Story = {
  args: {
    writes: [
      parked(0, "Call the dentist", "create", "gone", "Groceries"),
      parked(1, "Renew passport", "edit", "gone", "Groceries"),
      parked(2, "Book train tickets", "create", "gone", "Groceries"),
    ],
  },
};

/** Tasks from different lists and for different reasons. */
export const MixedListsAndReasons: Story = {
  args: {
    writes: [
      parked(0, "Call the dentist", "create", "gone", "Groceries"),
      parked(1, "Renew passport", "edit", "readOnly", "Team errands"),
      parked(2, "Book train tickets", "create", "gone", "Weekend"),
    ],
  },
};

/** While a move is running. */
export const Busy: Story = {
  args: { writes: [parked(0, "Call the dentist", "create", "gone", "Groceries")], busy: true },
};

/** The header button that reopens the dialog after "Decide later". */
export const EntryButton: StoryObj<typeof TasksRescueEntry> = {
  render: () => <TasksRescueEntry count={2} labels={defaultTasksLabels} onOpen={() => undefined} />,
};
