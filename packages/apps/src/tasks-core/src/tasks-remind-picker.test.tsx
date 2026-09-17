import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remindButtonLabel, tasksAlarmRowLabels } from "@/tasks-core/src/tasks-alert-mapping";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksRemindIndicator, TasksRemindPicker } from "@/tasks-core/src/tasks-remind-picker";
import {
  absoluteReminderAlert,
  offsetReminderAlert,
  taskAlertsFromList,
} from "@/tasks-core/src/tasks-task-utils";
import type { Task } from "@/tasks-core/src/tasks-types";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-main-view.css";
import "@/tasks-core/src/tasks-workspace.css";

function renderPicker(overrides: Partial<ComponentProps<typeof TasksRemindPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <TasksRemindPicker
        labels={defaultTasksLabels}
        alerts={undefined}
        onChange={onChange}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onChange };
}

const alarmLabels = tasksAlarmRowLabels(defaultTasksLabels);

function remindButton(alerts?: Task["alerts"]) {
  return screen.getByRole("button", { name: remindButtonLabel(defaultTasksLabels, alerts) });
}

function chooseOffset(optionLabel: string, index = 0) {
  fireEvent.click(screen.getAllByRole("combobox", { name: alarmLabels.eventAlarmOffset })[index]!);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("TasksRemindPicker", () => {
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

  it("opens the shared alarms dialog from a labeled button", () => {
    renderPicker();

    const trigger = remindButton();
    expect(trigger.textContent).toContain("No reminders");
    expect(trigger.classList.contains("tasks-main-view__remind-button--active")).toBe(false);
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: defaultTasksLabels.remindMe });
    expect(dialog.classList.contains("tasks-dialog-surface")).toBe(true);
    expect(screen.getAllByRole("heading", { name: defaultTasksLabels.remindMe })).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Alarms" })).toBeNull();
    expect(dialog.querySelector(".ui-modal-header")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.closest(".tasks-remind-dialog")).toBeTruthy();
    expect(close.closest(".calendar-alarms-card")).toBeNull();
    expect(document.querySelector(".tasks-remind-dialog__alarms")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("combobox", { name: alarmLabels.eventAlarmOffset })[0]!);
    expect(
      screen.getByRole("option", { name: defaultTasksLabels.remindAtTimeOfTask }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "At time of event" })).toBeNull();
    expect(screen.queryByRole("option", { name: /^Custom$/i })).toBeNull();
  });

  it("adds a due-relative alarm and marks the icon active without a badge", () => {
    const { onChange } = renderPicker();

    fireEvent.click(remindButton());
    chooseOffset(alarmLabels.eventAlarm30Min);

    expect(onChange).toHaveBeenCalledWith(taskAlertsFromList([offsetReminderAlert("-PT30M")]));
  });

  it("shows a count badge and accessible name when more than one alarm is set", () => {
    const alerts = {
      alert1: offsetReminderAlert("-PT30M"),
      alert2: offsetReminderAlert("-PT1H"),
    };
    renderPicker({ alerts });

    const trigger = remindButton(alerts);
    expect(trigger.classList.contains("tasks-main-view__remind-button--active")).toBe(true);
    expect(trigger.textContent).toContain("2 reminders");
    expect(document.querySelector(".tasks-main-view__remind-badge")?.textContent).toBe("2");
  });

  it("clears the last alarm back to undefined", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    const { onChange } = renderPicker({ alerts });

    const trigger = remindButton(alerts);
    expect(trigger.classList.contains("tasks-main-view__remind-button--active")).toBe(true);
    expect(trigger.textContent).toContain("Reminding 30 mins before");
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();

    fireEvent.click(trigger);
    chooseOffset(alarmLabels.eventAlarmNone);

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("shows leftover offsets as a disabled option without coercing them", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT45M")]);
    renderPicker({ alerts });

    fireEvent.click(remindButton(alerts));
    fireEvent.click(screen.getAllByRole("combobox", { name: alarmLabels.eventAlarmOffset })[0]!);

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
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
  });

  it("shows the shared offset label next to the bell when one alarm is set", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={alerts} />);

    expect(screen.getByText("Reminding 30 mins before")).toBeTruthy();
    expect(document.querySelector(".tasks-main-view__remind--row")).toBeTruthy();
    expect(document.querySelector(".tasks-main-view__remind-row-chip")).toBeNull();
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows Remind me for a single absolute alarm", () => {
    const alerts = taskAlertsFromList([absoluteReminderAlert("2026-07-08T17:00:00")]);
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={alerts} />);

    expect(screen.getByText(defaultTasksLabels.remindMe)).toBeTruthy();
    expect(screen.queryByText("No reminders")).toBeNull();
  });

  it("shows the shared count label when more than one alarm is set", () => {
    render(
      <TasksRemindIndicator
        labels={defaultTasksLabels}
        alerts={{
          alert1: offsetReminderAlert("-PT30M"),
          alert2: offsetReminderAlert("-PT1H"),
        }}
      />,
    );

    expect(screen.getByText("2 reminders")).toBeTruthy();
    expect(document.querySelector(".tasks-main-view__remind-badge")?.textContent).toBe("2");
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
  });
});
