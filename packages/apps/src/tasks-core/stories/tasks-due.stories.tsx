import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  TasksComposerDuePicker,
  TasksDueAllDaySwitch,
} from "@/tasks-core/src/tasks-composer-due-picker";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { dueDateToApiValue, type TaskDueFields } from "@/tasks-core/src/tasks-task-utils";
import { TasksStoryScope } from "@/tasks-core/stories/tasks-story-scope";

const L = defaultTasksLabels;

/** A day `offset` days from today, as a date-only due. */
function dayFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dueDateToApiValue(date);
}

/** The due field and its All day switch, as the task detail wires them. */
function TasksDueHarness({
  due,
  showWithoutTime = true,
}: {
  due: string;
  showWithoutTime?: boolean;
}) {
  const [value, setValue] = useState<Pick<TaskDueFields, "due" | "showWithoutTime">>({
    due,
    showWithoutTime,
  });
  const props = {
    labels: L,
    due: value.due,
    showWithoutTime: value.showWithoutTime,
    onChange: (next: TaskDueFields) =>
      setValue({ due: next.due, showWithoutTime: next.showWithoutTime }),
  };
  return (
    <TasksStoryScope variant="main">
      <div className="flex flex-col items-start gap-3 p-4">
        <TasksComposerDuePicker {...props} />
        <TasksDueAllDaySwitch {...props} />
      </div>
    </TasksStoryScope>
  );
}

const meta: Meta<typeof TasksDueHarness> = {
  title: "Features/Tasks/Panes/Due",
  component: TasksDueHarness,
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof TasksDueHarness>;

const dueTrigger = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole("button", { name: new RegExp(`^${L.addTaskDue}:`) });

/** The colour a token resolves to, read through a probe element. */
function tokenColor(canvasElement: HTMLElement, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  canvasElement.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export const Upcoming: Story = {
  args: { due: dayFromToday(3) },
  play: async ({ canvasElement }) => {
    await expect(dueTrigger(canvasElement).textContent).toBe("In 3 days");
    await expect(getComputedStyle(dueTrigger(canvasElement)).color).not.toBe(
      tokenColor(canvasElement, "--color-warning"),
    );
  },
};

/** Due today warns. */
export const Today: Story = {
  args: { due: dayFromToday(0) },
  play: async ({ canvasElement }) => {
    await expect(dueTrigger(canvasElement).textContent).toBe("Today");
    await expect(getComputedStyle(dueTrigger(canvasElement)).color).toBe(
      tokenColor(canvasElement, "--color-warning"),
    );
  },
};

/** An earlier day is an error, the time field in the same colour. */
export const Overdue: Story = {
  args: { due: `${dayFromToday(-2)}T09:00:00`, showWithoutTime: false },
  play: async ({ canvasElement }) => {
    const error = tokenColor(canvasElement, "--color-error");
    await expect(dueTrigger(canvasElement).textContent).toBe("2 days ago");
    await expect(getComputedStyle(dueTrigger(canvasElement)).color).toBe(error);
    const time = within(canvasElement).getByLabelText<HTMLInputElement>(L.dueTimeLabel);
    await expect(time.value).toBe("09:00");
    await expect(getComputedStyle(time).color).toBe(error);
  },
};

/** The day picker is frosted floating chrome, as the menus. */
export const FrostedPicker: Story = {
  args: { due: dayFromToday(3) },
  play: async ({ canvasElement }) => {
    await userEvent.click(dueTrigger(canvasElement));
    const popover = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(".tasks-field__due-popover");
      if (!element) throw new Error("no popover yet");
      return element;
    });
    await expect(popover.classList.contains("popover-ui--frost")).toBe(true);
    await expect(getComputedStyle(popover).backdropFilter).toContain("blur");
    await expect(getComputedStyle(popover).borderTopWidth).toBe("0px");
    await userEvent.keyboard("{Escape}");
  },
};

/** All day off gives the due a time; on removes it. */
export const AllDaySwitch: Story = {
  args: { due: dayFromToday(3) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const allDay = canvas.getByRole("switch", { name: L.dueAllDay });
    await expect(canvas.queryByLabelText(L.dueTimeLabel)).toBeNull();
    await userEvent.click(allDay);
    await expect(canvas.getByLabelText<HTMLInputElement>(L.dueTimeLabel).value).toBe("09:00");
    await userEvent.click(allDay);
    await expect(canvas.queryByLabelText(L.dueTimeLabel)).toBeNull();
  },
};
