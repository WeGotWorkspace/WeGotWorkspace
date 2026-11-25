import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  TASKS_NEW_TASK_PREFS_STORAGE_KEY,
  readTasksNewTaskPrefs,
  writeTasksNewTaskPrefs,
} from "@/lib/tasks-new-task-prefs";
import { SettingsTasksNewTaskPane } from "@/settings-core/src/settings-tasks-new-task-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Tasks new-task defaults",
  component: SettingsTasksNewTaskPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
  beforeEach: () => {
    window.localStorage.removeItem(TASKS_NEW_TASK_PREFS_STORAGE_KEY);
    return () => window.localStorage.removeItem(TASKS_NEW_TASK_PREFS_STORAGE_KEY);
  },
} satisfies Meta<typeof SettingsTasksNewTaskPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No priority and not started until a choice is made. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Default priority" })).toHaveTextContent(
      "None",
    );
    await expect(canvas.getByRole("combobox", { name: "Default status" })).toHaveTextContent(
      "Not started",
    );
  },
};

/** A stored choice is what the fields show, and a change saves itself. */
export const Stored: Story = {
  beforeEach: () => {
    writeTasksNewTaskPrefs({ priority: 1, status: "in-process" });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Default priority" })).toHaveTextContent(
      "High",
    );
    await expect(canvas.getByRole("combobox", { name: "Default status" })).toHaveTextContent(
      "In progress",
    );
    await userEvent.click(canvas.getByRole("combobox", { name: "Default status" }));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Not started" }),
    );
    await waitFor(() => expect(readTasksNewTaskPrefs().status).toBe("needs-action"));
  },
};
