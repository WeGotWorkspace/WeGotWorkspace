import type { Meta, StoryObj } from "@storybook/react-vite";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksMainView } from "@/tasks-core/src/tasks-main-view";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const bootstrap = createTasksAppBootstrap();

const meta: Meta<typeof TasksMainView> = {
  title: "Features/Tasks/Main view",
  component: TasksMainView,
  decorators: [
    (Story) => (
      <TasksStoryScope variant="main">
        <Story />
      </TasksStoryScope>
    ),
  ],
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof TasksMainView>;

export const MainView: Story = {
  args: {
    L: defaultTasksLabels,
    displayTasks: bootstrap.data.tasks,
    exitingTaskIds: new Set<string>(),
    taskLists: bootstrap.data.taskLists,
    defaultListId: "default",
    view: "state:all",
    canCreate: true,
    onToggleComplete: () => undefined,
    onEditTask: () => undefined,
    onDeleteTask: () => undefined,
    onCreateTask: () => undefined,
    onTaskExitAnimationEnd: () => undefined,
    itemDragHandlers: () => ({}),
    isItemDragging: () => false,
  },
};
