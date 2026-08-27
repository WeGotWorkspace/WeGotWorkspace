import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { remindButtonLabel } from "@/tasks-core/src/tasks-alert-mapping";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { TasksRemindIndicator, TasksRemindPicker } from "@/tasks-core/src/tasks-remind-picker";
import { offsetReminderAlert, taskAlertsFromList } from "@/tasks-core/src/tasks-task-utils";
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

function remindButton(alerts?: Task["alerts"]) {
  return screen.getByRole("button", { name: remindButtonLabel(defaultTasksLabels, alerts) });
}

function chooseOffset(optionLabel: string, index = 0) {
  fireEvent.click(
    screen.getAllByRole("combobox", { name: defaultCalendarLabels.eventAlarmOffset })[index]!,
  );
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

  it("opens the shared alarms dialog from an icon button", () => {
    renderPicker();

    const trigger = remindButton();
    expect(trigger.getAttribute("aria-label")).toBe("No reminders");
    expect(trigger.classList.contains("icon-button--active")).toBe(false);
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: defaultCalendarLabels.eventAlarmsLabel });
    expect(dialog.classList.contains("tasks-dialog-surface")).toBe(true);
    expect(
      screen.getAllByRole("heading", { name: defaultCalendarLabels.eventAlarmsLabel }),
    ).toHaveLength(1);
    expect(dialog.querySelector(".ui-modal-header")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.closest(".tasks-remind-dialog")).toBeTruthy();
    expect(close.closest(".calendar-alarms-card")).toBeNull();
    expect(document.querySelector(".tasks-remind-dialog__alarms")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Custom$/i })).toBeNull();
  });

  it("adds a due-relative alarm and marks the icon active without a badge", () => {
    const { onChange } = renderPicker();

    fireEvent.click(remindButton());
    chooseOffset(defaultCalendarLabels.eventAlarm30Min);

    expect(onChange).toHaveBeenCalledWith(taskAlertsFromList([offsetReminderAlert("-PT30M")]));
  });

  it("shows a count badge and accessible name when more than one alarm is set", () => {
    const alerts = {
      alert1: offsetReminderAlert("-PT30M"),
      alert2: offsetReminderAlert("-PT1H"),
    };
    renderPicker({ alerts });

    const trigger = remindButton(alerts);
    expect(trigger.classList.contains("icon-button--active")).toBe(true);
    expect(trigger.getAttribute("aria-label")).toBe("Reminding 1 hour and 30 mins before");
    expect(document.querySelector(".tasks-main-view__remind-badge")?.textContent).toBe("2");
  });

  it("clears the last alarm back to undefined", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    const { onChange } = renderPicker({ alerts });

    const trigger = remindButton(alerts);
    expect(trigger.classList.contains("icon-button--active")).toBe(true);
    expect(trigger.getAttribute("aria-label")).toBe("Reminding 30 mins before");
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();

    fireEvent.click(trigger);
    chooseOffset(defaultCalendarLabels.eventAlarmNone);

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("shows leftover offsets as a disabled option without coercing them", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT45M")]);
    renderPicker({ alerts });

    fireEvent.click(remindButton(alerts));
    fireEvent.click(
      screen.getAllByRole("combobox", { name: defaultCalendarLabels.eventAlarmOffset })[0]!,
    );

    const foreign = screen.getByRole("option", { name: /45 minutes before/i });
    expect(foreign.hasAttribute("disabled") || foreign.getAttribute("data-disabled") !== null).toBe(
      true,
    );
  });
});

describe("TasksRemindIndicator", () => {
  it("hides entirely when the task has no alerts", () => {
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={undefined} />);

    expect(screen.queryByRole("img", { name: /Reminding|No reminders/ })).toBeNull();
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
  });

  it("shows a non-interactive bell when one alarm is set", () => {
    const alerts = taskAlertsFromList([offsetReminderAlert("-PT30M")]);
    render(<TasksRemindIndicator labels={defaultTasksLabels} alerts={alerts} />);

    expect(screen.getByRole("img", { name: "Reminding 30 mins before" })).toBeTruthy();
    expect(document.querySelector(".tasks-main-view__remind-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a count badge and accessible name when more than one alarm is set", () => {
    render(
      <TasksRemindIndicator
        labels={defaultTasksLabels}
        alerts={{
          alert1: offsetReminderAlert("-PT30M"),
          alert2: offsetReminderAlert("-PT1H"),
        }}
      />,
    );

    expect(screen.getByRole("img", { name: "Reminding 1 hour and 30 mins before" })).toBeTruthy();
    expect(document.querySelector(".tasks-main-view__remind-badge")?.textContent).toBe("2");
    expect(screen.queryByRole("button", { name: /Reminding|No reminders/ })).toBeNull();
  });
});
