import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { taskAlarmControls } from "@/tasks-core/src/tasks-remind-picker";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { tasksAlarmRowLabels } from "@/tasks-core/src/tasks-alert-mapping";
import type { Task } from "@/lib/models/tasks-types";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";
import { offsetReminderAlert } from "@/tasks-core/src/tasks-task-utils";

const L = defaultTasksLabels;
const alarmLabels = tasksAlarmRowLabels(L);

/** The alarm rows of the task detail: one per alarm, then an empty one for the next. */
function TasksAlarmsHarness({
  initial,
  disabled = false,
}: {
  initial?: Task["alerts"];
  disabled?: boolean;
}) {
  const [alerts, setAlerts] = useState<Task["alerts"] | undefined>(initial);
  return (
    <TasksStoryScope variant="main">
      <div className="flex flex-col items-start gap-2 p-4">
        {taskAlarmControls({ labels: L, alerts, onChange: setAlerts, disabled }).map(
          (row, index) => (
            <div key={index}>{row}</div>
          ),
        )}
      </div>
    </TasksStoryScope>
  );
}

const meta: Meta<typeof TasksAlarmsHarness> = {
  title: "Features/Tasks/Panes/Alarms",
  component: TasksAlarmsHarness,
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof TasksAlarmsHarness>;

const alarmNames = (canvasElement: HTMLElement) =>
  within(canvasElement)
    .getAllByRole("combobox", { name: /^Alarm \d+$/ })
    .map((trigger) => trigger.textContent);

export const None: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(alarmNames(canvasElement)).toEqual([alarmLabels.eventAlarmNone]);
  },
};

/** Setting the empty row adds an alarm and a new empty row; None removes one. */
export const AddAndRemove: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    const pick = async (index: number, option: string) => {
      await userEvent.click(canvas.getAllByRole("combobox", { name: /^Alarm \d+$/ })[index]!);
      await userEvent.click(await page.findByRole("option", { name: option }));
    };

    await pick(0, alarmLabels.eventAlarm30Min);
    await waitFor(() =>
      expect(alarmNames(canvasElement)).toEqual([
        alarmLabels.eventAlarm30Min,
        alarmLabels.eventAlarmNone,
      ]),
    );
    await pick(1, alarmLabels.eventAlarm1Day);
    await waitFor(() =>
      expect(alarmNames(canvasElement)).toEqual([
        alarmLabels.eventAlarm30Min,
        alarmLabels.eventAlarm1Day,
        alarmLabels.eventAlarmNone,
      ]),
    );
    await pick(0, alarmLabels.eventAlarmNone);
    await waitFor(() =>
      expect(alarmNames(canvasElement)).toEqual([
        alarmLabels.eventAlarm1Day,
        alarmLabels.eventAlarmNone,
      ]),
    );
  },
};

export const ReadOnly: Story = {
  args: {
    disabled: true,
    initial: { alert1: offsetReminderAlert("-PT30M"), alert2: offsetReminderAlert("-PT1H") },
  },
  play: async ({ canvasElement }) => {
    await expect(alarmNames(canvasElement)).toEqual([
      alarmLabels.eventAlarm30Min,
      alarmLabels.eventAlarm1Hour,
    ]);
  },
};
