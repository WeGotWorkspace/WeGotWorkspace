import type { Meta, StoryObj } from "@storybook/react-vite";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksEditDialog } from "@/tasks-core/src/tasks-edit-dialog";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const bootstrap = createTasksAppBootstrap();
const reminded = bootstrap.data.tasks[2]!;

const meta: Meta<typeof TasksEditDialog> = {
  title: "Apps/Tasks/Panes/Edit dialog",
  component: TasksEditDialog,
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
type Story = StoryObj<typeof TasksEditDialog>;

export const WithReminder: Story = {
  args: {
    dialog: { taskId: reminded.id },
    task: reminded,
    taskLists: bootstrap.data.taskLists,
    labels: defaultTasksLabels,
    onClose: () => undefined,
    onSave: () => undefined,
  },
};
