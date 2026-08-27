import { describe, expect, it } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  formValuesToTaskAlerts,
  remindButtonLabel,
  taskAlertCount,
  taskAlertsToFormValues,
  tasksAlarmRowLabels,
} from "@/tasks-core/src/tasks-alert-mapping";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { absoluteReminderAlert, offsetReminderAlert } from "@/tasks-core/src/tasks-task-utils";
import type { Task, TaskAlert } from "@/tasks-core/src/tasks-types";

describe("task alert mapping", () => {
  it("maps OffsetTrigger relativeTo end to relatedTo end and back", () => {
    const alerts: Task["alerts"] = {
      alert1: offsetReminderAlert("-PT30M"),
    };
    const rows = taskAlertsToFormValues(alerts);
    expect(rows).toEqual([{ id: "alert1", action: "display", offset: "-PT30M", relatedTo: "end" }]);
    expect(formValuesToTaskAlerts(rows)).toEqual(alerts);
  });

  it("preserves relativeTo start without coercing to the task due default", () => {
    const alerts: Task["alerts"] = {
      alert1: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "OffsetTrigger", offset: "-PT15M", relativeTo: "start" },
      },
    };
    const rows = taskAlertsToFormValues(alerts);
    expect(rows).toEqual([
      { id: "alert1", action: "display", offset: "-PT15M", relatedTo: "start" },
    ]);
    expect(formValuesToTaskAlerts(rows)).toEqual(alerts);
  });

  it("defaults missing relativeTo to end on the way out", () => {
    const alerts: Task["alerts"] = {
      alert1: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "OffsetTrigger", offset: "PT0S" } as TaskAlert["trigger"],
      },
    };
    expect(taskAlertsToFormValues(alerts)).toEqual([
      { id: "alert1", action: "display", offset: "PT0S", relatedTo: "end" },
    ]);
    expect(formValuesToTaskAlerts(taskAlertsToFormValues(alerts))).toEqual({
      alert1: offsetReminderAlert("PT0S"),
    });
  });

  it("round-trips leftover offsets without coercing them to a preset", () => {
    const alerts: Task["alerts"] = {
      alert1: offsetReminderAlert("-PT45M"),
    };
    const rows = taskAlertsToFormValues(alerts);
    expect(rows[0]?.offset).toBe("-PT45M");
    expect(formValuesToTaskAlerts(rows)).toEqual(alerts);
  });

  it("round-trips AbsoluteTrigger when values", () => {
    const alerts: Task["alerts"] = {
      custom: absoluteReminderAlert("2026-07-08T17:00:00"),
    };
    const rows = taskAlertsToFormValues(alerts);
    expect(rows).toEqual([
      { id: "custom", action: "display", offset: null, when: "2026-07-08T17:00:00" },
    ]);
    expect(formValuesToTaskAlerts(rows)).toEqual(alerts);
  });

  it("maps multiple keys and treats empty as undefined, never {}", () => {
    const alerts: Task["alerts"] = {
      alert1: offsetReminderAlert("-PT30M"),
      alert2: offsetReminderAlert("-PT1H"),
    };
    expect(taskAlertCount(alerts)).toBe(2);
    expect(formValuesToTaskAlerts(taskAlertsToFormValues(alerts))).toEqual(alerts);
    expect(formValuesToTaskAlerts([])).toBeUndefined();
    expect(taskAlertsToFormValues(undefined)).toEqual([]);
    expect(taskAlertsToFormValues(null)).toEqual([]);
  });

  it("labels the remind control from relative alarm state", () => {
    expect(remindButtonLabel(defaultTasksLabels, undefined)).toBe("No reminders");
    expect(remindButtonLabel(defaultTasksLabels, {})).toBe("No reminders");
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("-PT5M") })).toBe(
      "Reminding 5 mins before",
    );
    expect(
      remindButtonLabel(defaultTasksLabels, {
        alert1: offsetReminderAlert("-PT5M"),
        alert2: offsetReminderAlert("-P1D"),
      }),
    ).toBe("Reminding 1 day and 5 mins before");
    expect(
      remindButtonLabel(defaultTasksLabels, {
        alert1: offsetReminderAlert("-PT30M"),
        alert2: offsetReminderAlert("-PT1H"),
      }),
    ).toBe("Reminding 1 hour and 30 mins before");
    expect(
      remindButtonLabel(defaultTasksLabels, {
        alert1: offsetReminderAlert("-PT5M"),
        alert2: offsetReminderAlert("-PT1H"),
        alert3: offsetReminderAlert("-P1D"),
      }),
    ).toBe("Reminding 1 day, 1 hour and 5 mins before");
    expect(remindButtonLabel(defaultTasksLabels, { leftover: offsetReminderAlert("-PT45M") })).toBe(
      "Reminding 45 mins before",
    );
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("-PT10M") })).toBe(
      "Reminding 10 mins before",
    );
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("-PT15M") })).toBe(
      "Reminding 15 mins before",
    );
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("-PT30M") })).toBe(
      "Reminding 30 mins before",
    );
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("-PT1H") })).toBe(
      "Reminding 1 hour before",
    );
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("-P1D") })).toBe(
      "Reminding 1 day before",
    );
    expect(remindButtonLabel(defaultTasksLabels, { alert1: offsetReminderAlert("PT5M") })).toBe(
      "Reminding 5 mins after",
    );
    expect(
      remindButtonLabel(defaultTasksLabels, {
        custom: absoluteReminderAlert("2026-07-08T17:00:00"),
      }),
    ).toBe(defaultTasksLabels.remindMe);
    expect(
      remindButtonLabel(defaultTasksLabels, {
        alert1: offsetReminderAlert("-PT30M"),
        alert2: offsetReminderAlert("PT5M"),
      }),
    ).toBe("Reminding 30 mins before and 5 mins after");
  });

  it("adapts Tasks dialog copy and keeps shared calendar offset presets", () => {
    const alarmLabels = tasksAlarmRowLabels(defaultTasksLabels);
    expect(alarmLabels.eventAlarmsLabel).toBe(defaultTasksLabels.remindMe);
    expect(alarmLabels.eventAlarmAtStart).toBe(defaultTasksLabels.remindAtTimeOfTask);
    expect(alarmLabels.eventAlarm30Min).toBe(defaultCalendarLabels.eventAlarm30Min);
    expect(alarmLabels.eventAlarmAtStart).not.toBe(defaultCalendarLabels.eventAlarmAtStart);
  });
});
