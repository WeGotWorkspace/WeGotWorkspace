import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { tasksStoryOperations } from "@/tasks-core/stories/tasks-story-shared";

const brandingMeta = createBrandingStoryMeta({
  appId: "tasks",
  workspaceClass: "tasks-workspace",
  accentToken: "workspace-accent",
  component: TasksWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Themes/Tasks",
  tags: ["vitest-ci"],
} satisfies Meta<typeof TasksWorkspace>;

export default meta;
type Story = StoryObj<typeof TasksWorkspace>;

export const Default: Story = {
  args: {
    ...createTasksAppBootstrap(),
    operations: tasksStoryOperations,
  },
};
