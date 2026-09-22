import type { Meta, StoryObj } from "@storybook/react-vite";
import { createSharedTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { tasksStoryOperations } from "@/tasks-core/stories/tasks-story-shared";

const meta: Meta<typeof TasksWorkspace> = {
  title: "Features/Tasks",
  component: TasksWorkspace,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    operations: tasksStoryOperations,
  },
};

export default meta;
type Story = StoryObj<typeof TasksWorkspace>;

/** Chrome Default lives under Branding/Tasks — shared-list layout. */
export const SharedWithMe: Story = {
  args: {
    ...createSharedTasksAppBootstrap(),
  },
};
