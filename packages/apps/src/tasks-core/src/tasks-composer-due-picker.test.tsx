import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TasksComposerDuePicker } from "@/tasks-core/src/tasks-composer-due-picker";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { COMPOSER_SELECT_TRIGGER_CLASS } from "@/tasks-core/src/tasks-task-form";
import type { TaskDueFields } from "@/tasks-core/src/tasks-task-utils";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-main-view.css";

function StatefulDuePicker({ onChange, ...props }: ComponentProps<typeof TasksComposerDuePicker>) {
  const [dueValue, setDueValue] = useState<TaskDueFields>({
    due: props.due,
    showWithoutTime: props.showWithoutTime ?? true,
    timeZone: props.timeZone ?? null,
  });
  return (
    <TasksComposerDuePicker
      {...props}
      due={dueValue.due}
      showWithoutTime={dueValue.showWithoutTime}
      timeZone={dueValue.timeZone}
      onChange={(next) => {
        setDueValue(next);
        onChange(next);
      }}
    />
  );
}

function renderDuePicker(overrides: Partial<ComponentProps<typeof TasksComposerDuePicker>> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <StatefulDuePicker
        labels={defaultTasksLabels}
        due={null}
        showWithoutTime
        timeZone={null}
        onChange={onChange}
        triggerClassName={COMPOSER_SELECT_TRIGGER_CLASS}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onChange };
}

function selectDay(date: Date): void {
  const dataDay = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  const dayButton = document.querySelector(`button[data-day="${dataDay}"]`);
  expect(dayButton).toBeTruthy();
  fireEvent.click(dayButton!);
}

describe("TasksComposerDuePicker", () => {
  const now = new Date(2026, 6, 8, 12, 0, 0);

  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a date-only due and keeps the popover open for time", () => {
    const { onChange } = renderDuePicker();

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
    selectDay(now);

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-08",
      showWithoutTime: true,
      timeZone: null,
    });
    expect(screen.getByRole("button", { name: defaultTasksLabels.dueAddTime })).toBeTruthy();
    expect(screen.queryByLabelText(defaultTasksLabels.dueTimeLabel)).toBeNull();
  });

  it("adds wall-clock time and a timezone using the calendar floating option", () => {
    const { onChange } = renderDuePicker({
      due: "2026-07-08",
      showWithoutTime: true,
      timeZone: null,
    });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.dueAddTime }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        due: "2026-07-08T09:00:00",
        showWithoutTime: false,
      }),
    );

    const timedCall = onChange.mock.calls.at(-1)?.[0] as { timeZone: string | null };
    expect(timedCall.timeZone === null || typeof timedCall.timeZone === "string").toBe(true);
  });

  it("shows time and timezone controls for a timed due and can switch to floating", () => {
    renderDuePicker({
      due: "2026-07-08T15:45:00",
      showWithoutTime: false,
      timeZone: "Europe/Amsterdam",
    });

    const trigger = screen.getByLabelText(defaultTasksLabels.addTaskDue);
    expect(trigger.textContent).toContain(defaultTasksLabels.dueToday);
    expect(trigger.textContent).toMatch(/\d{1,2}:\d{2}/);

    fireEvent.click(trigger);
    expect((screen.getByLabelText(defaultTasksLabels.dueTimeLabel) as HTMLInputElement).value).toBe(
      "15:45",
    );

    fireEvent.click(screen.getByLabelText(defaultCalendarLabels.eventTimeZoneLabel));
    fireEvent.click(
      screen.getByRole("option", { name: defaultCalendarLabels.eventTimeZoneLocalLabel }),
    );
  });

  it("returns to date-only from a timed due", () => {
    const { onChange } = renderDuePicker({
      due: "2026-07-08T15:45:00",
      showWithoutTime: false,
      timeZone: "Europe/Amsterdam",
    });

    fireEvent.click(screen.getByLabelText(defaultTasksLabels.addTaskDue));
    fireEvent.click(screen.getByRole("button", { name: defaultTasksLabels.dueDateOnly }));

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-08",
      showWithoutTime: true,
      timeZone: null,
    });
  });
});
