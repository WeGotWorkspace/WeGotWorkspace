import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasksAlarmRowLabels } from "@/tasks-core/src/tasks-alert-mapping";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksRemindIndicator, taskAlarmControls } from "@/tasks-core/src/tasks-remind-picker";
import {
  absoluteReminderAlert,
  offsetReminderAlert,
  taskAlertsFromList,
} from "@/tasks-core/src/tasks-task-utils";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-field-controls.css";
import "@/tasks-core/src/tasks-workspace.css";

function renderAlarms(overrides: Partial<Parameters<typeof taskAlarmControls>[0]> = {}) {
  const onChange = vi.fn();
  const rows = taskAlarmControls({
    labels: defaultTasksLabels,
    alerts: undefined,
    onChange,
    ...overrides,
  });
  render(<TooltipProvider>{rows}</TooltipProvider>);
  return { onChange, rows };
}

const alarmLabels = tasksAlarmRowLabels(defaultTasksLabels);

function alarmTriggers() {
  return screen.getAllByRole("combobox", { name: /^Alarm \d+$/ });
}

function chooseOffset(optionLabel: string, index = 0) {
  fireEvent.click(alarmTriggers()[index]!);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("taskAlarmControls", () => {
  beforeEach(() => {
    cleanup();
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
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("starts with one empty alarm row, a ghost dropdown with the task presets", () => {
    renderAlarms();

    const [trigger] = alarmTriggers();
    expect(alarmTriggers()).toHaveLength(1);
    expect(trigger!.textContent).toBe(alarmLabels.eventAlarmNone);
    expect(trigger!.classList.contains("collection-ghost-select")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger!);
    expect(
      screen.getByRole("option", { name: defaultTasksLabels.remindAtTimeOfTask }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "At time of event" })).toBeNull();
  });

  it("adds a due-relative alarm from the empty row", () => {
    const { onChange } = renderAlarms();

    chooseOffset(alarmLabels.eventAlarm30Min);

    expect(onChange).toHaveBeenCalledWith(taskAlertsFromList([offsetReminderAlert("-PT30M")]));
  });

  it("shows one row per alarm, then an empty one for the next", () => {
    const alerts = {
      alert1: offsetReminderAlert("-PT30M"),
      alert2: offsetReminderAlert("-PT1H"),
    };
    renderAlarms({ alerts });

    expect(alarmTriggers().map((trigger) => trigger.textContent)).toEqual([
      alarmLabels.eventAlarm30Min,
      alarmLabels.eventAlarm1Hour,
      alarmLabels.eventAlarmNone,
    ]);
    expect(alarmTriggers().map((trigger) => trigger.getAttribute("aria-label"))).toEqual([
      defaultTasksLabels.detailAlarm(1),
      defaultTasksLabels.detailAlarm(2),
      defaultTasksLabels.detailAlarm(3),
    ]);
  });

  it("removes an alarm when its row is set to None", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    const { onChange } = renderAlarms({ alerts });

    chooseOffset(alarmLabels.eventAlarmNone);

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("read-only shows the set alarms only, disabled", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    renderAlarms({ alerts, disabled: true });

    expect(alarmTriggers()).toHaveLength(1);
    expect(alarmTriggers()[0]).toHaveProperty("disabled", true);
  });

  it("shows leftover offsets as a disabled option without coercing them", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT45M")]);
    renderAlarms({ alerts });

    fireEvent.click(alarmTriggers()[0]!);

    const foreign = screen.getByRole("option", { name: /45 minutes before/i });
    expect(foreign.hasAttribute("disabled") || foreign.getAttribute("data-disabled") !== null).toBe(
      true,
    );
  });
});

describe("TasksRemindIndicator", () => {
  it("hides entirely when the task has no alerts", () => {
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={undefined} />);

    expect(screen.queryByText("No reminders")).toBeNull();
    expect(screen.queryByRole("img", { name: /Reminding|No reminders/ })).toBeNull();
    expect(document.querySelector(".tasks-field__remind-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
  });

  it("names the bell with the shared offset label when one alarm is set", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={alerts} />);

    expect(screen.getByRole("img", { name: "Reminding 30 mins before" })).toBeTruthy();
    expect(screen.queryByText("Reminding 30 mins before")).toBeNull();
    expect(document.querySelector(".tasks-field__remind--row")).toBeTruthy();
    expect(document.querySelector(".tasks-field__remind-row-chip")).toBeNull();
    expect(document.querySelector(".tasks-field__remind-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the bell Remind me for a single absolute alarm", () => {
    const alerts = taskAlertsFromList([absoluteReminderAlert("2026-07-08T17:00:00")]);
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={alerts} />);

    expect(screen.getByRole("img", { name: defaultTasksLabels.remindMe })).toBeTruthy();
    expect(screen.queryByText("No reminders")).toBeNull();
  });

  it("names the bell with the count for several alarms, but shows no number", () => {
    render(
      <TasksRemindIndicator
        labels={defaultTasksLabels}
        alerts={{
          alert1: offsetReminderAlert("-PT30M"),
          alert2: offsetReminderAlert("-PT1H"),
        }}
      />,
    );

    expect(screen.getByRole("img", { name: "2 reminders" })).toBeTruthy();
    expect(document.querySelector(".tasks-field__remind--row")?.textContent).toBe("");
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
  });
});
