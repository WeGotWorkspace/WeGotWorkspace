import type { ReactNode } from "react";
import { Bell } from "lucide-react";
import {
  AlarmOffsetMenuItems,
  alarmOffsetLabel,
  alarmOffsetSelectValue,
} from "@/alarms-card/src/alarms-card";
import { alertsAfterOffsetChange, isAlertOffsetSelectValue } from "@/lib/calendar/calendar-alerts";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent } from "@/ui/select";
import {
  TASK_FIELD_SELECT_CONTENT_CLASS,
  TASK_FIELD_SELECT_ITEM_CLASS,
} from "@/tasks-core/src/tasks-field-classes";
import type { Task } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  formValuesToTaskAlerts,
  remindButtonLabel,
  TASK_ALERT_DEFAULT_RELATED_TO,
  taskAlertCount,
  taskAlertsToFormValues,
  tasksAlarmRowLabels,
} from "@/tasks-core/src/tasks-alert-mapping";

type TasksRemindIndicatorProps = {
  labels: TasksUILabels;
  alerts: Task["alerts"] | undefined;
};

/** Display-only row mark: the bell alone (no count), named for screen readers. */
export function TasksRemindIndicator({ labels, alerts }: TasksRemindIndicatorProps) {
  if (taskAlertCount(alerts) === 0) return null;

  const label = remindButtonLabel(labels, alerts);

  return (
    <span
      className="tasks-field__remind tasks-field__remind--row"
      role="img"
      aria-label={label}
      title={label}
    >
      <Bell className="size-3.5" aria-hidden />
    </span>
  );
}

type TaskAlarmControlsArgs = {
  labels: TasksUILabels;
  alerts: Task["alerts"] | undefined;
  onChange: (alerts: Task["alerts"] | undefined) => void;
  disabled?: boolean;
};

/**
 * The task detail's alarm rows, as Calendar's alarm list: one ghost dropdown per alarm,
 * then an empty one (None) to add the next. None on a set alarm removes it. Read-only
 * shows the set alarms only (or one None).
 */
export function taskAlarmControls({
  labels,
  alerts,
  onChange,
  disabled = false,
}: TaskAlarmControlsArgs): ReactNode[] {
  const rows = taskAlertsToFormValues(alerts);
  const alarmLabels = tasksAlarmRowLabels(labels);
  const slots = disabled && rows.length > 0 ? rows : [...rows, null];
  return slots.map((alert, index) => (
    <Select
      key={alert?.id ?? "next"}
      value={alarmOffsetSelectValue(alert)}
      disabled={disabled}
      onValueChange={(value) => {
        if (!isAlertOffsetSelectValue(value)) return;
        const next = alertsAfterOffsetChange({
          alerts: rows,
          rowId: alert?.id ?? null,
          value,
          defaultRelatedTo: TASK_ALERT_DEFAULT_RELATED_TO,
        });
        onChange(formValuesToTaskAlerts(next));
      }}
    >
      <CollectionGhostSelectTrigger
        className="tasks-field__ghost"
        aria-label={labels.detailAlarm(index + 1)}
        disabled={disabled}
        leading={<Bell className="size-3.5" aria-hidden />}
        label={alarmOffsetLabel(alert, alarmLabels)}
      />
      <SelectContent className={TASK_FIELD_SELECT_CONTENT_CLASS}>
        <AlarmOffsetMenuItems
          alert={alert}
          labels={alarmLabels}
          itemClassName={TASK_FIELD_SELECT_ITEM_CLASS}
        />
      </SelectContent>
    </Select>
  ));
}
