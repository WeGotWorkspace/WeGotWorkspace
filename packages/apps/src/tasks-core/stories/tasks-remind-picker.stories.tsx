import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { TasksRemindPicker } from "@/tasks-core/src/tasks-remind-picker";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";
import { offsetReminderAlert } from "@/tasks-core/src/tasks-task-utils";

const reminded = createTasksAppBootstrap().data.tasks[2];

const meta: Meta<typeof TasksRemindPicker> = {
  title: "Apps/Tasks/Panes/RemindMe",
  component: TasksRemindPicker,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <TasksStoryScope variant="main">
        <div className="tasks-main-view__composer-meta">
          <Story />
        </div>
      </TasksStoryScope>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TasksRemindPicker>;

export const None: Story = {
  args: {
    labels: defaultTasksLabels,
    alerts: undefined,
    onChange: () => undefined,
  },
};

export const WithReminder: Story = {
  args: {
    ...None.args,
    alerts: reminded?.alerts,
  },
};

export const Multiple: Story = {
  args: {
    ...None.args,
    alerts: {
      alert1: offsetReminderAlert("-PT30M"),
      alert2: offsetReminderAlert("-PT1H"),
    },
  },
};

export const Opened: Story = {
  args: {
    ...Multiple.args,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: defaultTasksLabels.remindersCount(2) }),
    );
  },
};
