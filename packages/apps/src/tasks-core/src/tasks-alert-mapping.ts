import { Temporal } from "@js-temporal/polyfill";
import {
  alertActionFromWire,
  formatAlertOffsetQuantity,
  type CalendarEventAlertFormValue,
} from "@/lib/calendar/calendar-alerts";
import { defaultAlarmsCardLabels, type AlarmsCardLabels } from "@/alarms-card/src/alarms-card";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { Task, TaskAlert, TaskPatch } from "@/lib/models/tasks-types";

/** Tasks OpenAPI offsets are typically due-relative (`relativeTo: "end"`). */
export const TASK_ALERT_DEFAULT_RELATED_TO = "end" as const;

export function taskAlertsToFormValues(
  alerts: Task["alerts"] | null | undefined,
): CalendarEventAlertFormValue[] {
  if (!alerts) return [];
  const rows: CalendarEventAlertFormValue[] = [];
  for (const [id, alert] of Object.entries(alerts)) {
    const row = taskAlertToFormValue(id, alert);
    if (row) rows.push(row);
  }
  return rows;
}

function taskAlertToFormValue(id: string, alert: TaskAlert): CalendarEventAlertFormValue | null {
  const trigger = alert.trigger;
  if (!trigger || typeof trigger !== "object") return null;
  const action = alertActionFromWire(alert.action);
  if (
    trigger["@type"] === "OffsetTrigger" &&
    typeof trigger.offset === "string" &&
    trigger.offset.trim()
  ) {
    const relatedTo = trigger.relativeTo === "start" ? "start" : TASK_ALERT_DEFAULT_RELATED_TO;
    return {
      id,
      action,
      offset: trigger.offset,
      relatedTo,
    };
  }
  if (
    trigger["@type"] === "AbsoluteTrigger" &&
    typeof trigger.when === "string" &&
    trigger.when.trim()
  ) {
    return { id, action, offset: null, when: trigger.when };
  }
  return null;
}

export function formValuesToTaskAlerts(
  rows: CalendarEventAlertFormValue[],
): Task["alerts"] | undefined {
  if (rows.length === 0) return undefined;
  const map: Record<string, TaskAlert> = {};
  for (const row of rows) {
    const alert = formValueToTaskAlert(row);
    if (alert) map[row.id] = alert;
  }
  return Object.keys(map).length ? map : undefined;
}

function formValueToTaskAlert(row: CalendarEventAlertFormValue): TaskAlert | null {
  if (row.offset) {
    return {
      "@type": "Alert",
      action: "display",
      trigger: {
        "@type": "OffsetTrigger",
        offset: row.offset,
        relativeTo: row.relatedTo === "start" ? "start" : TASK_ALERT_DEFAULT_RELATED_TO,
      },
    };
  }
  if (row.when) {
    return {
      "@type": "Alert",
      action: "display",
      trigger: {
        "@type": "AbsoluteTrigger",
        when: row.when,
      },
    };
  }
  return null;
}

/**
 * The `alerts` of a task patch from `previous` to `next`. The API merges alerts per
 * id, so a removed alert goes as null; no alerts left clears them all.
 */
export function taskAlertsPatch(
  previous: Task["alerts"] | null | undefined,
  next: Task["alerts"] | null | undefined,
): TaskPatch["alerts"] {
  if (!next || Object.keys(next).length === 0) return null;
  const patch: Record<string, TaskAlert | null> = { ...next };
  for (const id of Object.keys(previous ?? {})) {
    if (!(id in next)) patch[id] = null;
  }
  return patch;
}

export function taskAlertCount(alerts: Task["alerts"] | null | undefined): number {
  return taskAlertsToFormValues(alerts).length;
}

function offsetAbsSeconds(offset: string): number {
  try {
    return Math.abs(Temporal.Duration.from(offset.replace(/^-/, "")).total({ unit: "seconds" }));
  } catch {
    return 0;
  }
}

function joinReminderDurations(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sortedQuantities(rows: CalendarEventAlertFormValue[], negated: boolean): string[] {
  return rows
    .flatMap((row) => {
      if (!row.offset) return [];
      if (row.offset.startsWith("-") !== negated) return [];
      const quantity = formatAlertOffsetQuantity(row.offset, "mins");
      return quantity ? [{ quantity, seconds: offsetAbsSeconds(row.offset) }] : [];
    })
    .sort((left, right) => right.seconds - left.seconds)
    .map((part) => part.quantity);
}

export function remindButtonLabel(
  labels: Pick<
    TasksUILabels,
    | "noReminders"
    | "remindersCount"
    | "remindingBefore"
    | "remindingAfter"
    | "remindingAfterClause"
    | "remindMe"
  >,
  alerts: Task["alerts"] | null | undefined,
): string {
  const rows = taskAlertsToFormValues(alerts);
  if (rows.length === 0) return labels.noReminders;
  if (rows.length > 1) return labels.remindersCount(rows.length);

  const before = sortedQuantities(rows, true);
  const after = sortedQuantities(rows, false);
  if (before.length === 0 && after.length === 0) return labels.remindMe;
  if (after.length === 0) return labels.remindingBefore(joinReminderDurations(before));
  if (before.length === 0) return labels.remindingAfter(joinReminderDurations(after));
  return `${labels.remindingBefore(joinReminderDurations(before))} and ${labels.remindingAfterClause(joinReminderDurations(after))}`;
}

/** Tasks dialog copy + shared calendar offset presets (intentional DRY). */
export function tasksAlarmRowLabels(
  labels: Pick<TasksUILabels, "remindMe" | "remindAtTimeOfTask">,
): AlarmsCardLabels {
  return {
    eventAlarmsLabel: labels.remindMe,
    eventAlarmRemove: defaultAlarmsCardLabels.eventAlarmRemove,
    eventAlarmOffset: defaultAlarmsCardLabels.eventAlarmOffset,
    eventAlarmNone: defaultAlarmsCardLabels.eventAlarmNone,
    eventAlarmAtStart: labels.remindAtTimeOfTask,
    eventAlarm5Min: defaultAlarmsCardLabels.eventAlarm5Min,
    eventAlarm10Min: defaultAlarmsCardLabels.eventAlarm10Min,
    eventAlarm15Min: defaultAlarmsCardLabels.eventAlarm15Min,
    eventAlarm30Min: defaultAlarmsCardLabels.eventAlarm30Min,
    eventAlarm1Hour: defaultAlarmsCardLabels.eventAlarm1Hour,
    eventAlarm1Day: defaultAlarmsCardLabels.eventAlarm1Day,
  };
}
