import { useState, type ReactNode } from "react";
import { Bell } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { CalendarAlarmsRows } from "@/calendar-core/src/calendar-alarms-card";
import { CardPanel } from "@/card/src/card-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import type { Task } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  formValuesToTaskAlerts,
  remindButtonLabel,
  taskAlertCount,
  taskAlertsToFormValues,
  tasksAlarmRowLabels,
} from "@/tasks-core/src/tasks-alert-mapping";

type TasksRemindVisualProps = {
  count: number;
  className?: string;
  label?: string;
  children: ReactNode;
};

/** Shared bell + count badge used by the composer/edit picker and list-row indicator. */
function TasksRemindVisual({ count, className, label, children }: TasksRemindVisualProps) {
  return (
    <span
      className={`tasks-main-view__remind${className ? ` ${className}` : ""}`}
      {...(label ? { role: "img" as const, "aria-label": label } : {})}
    >
      {children}
      {count > 1 ? (
        <span className="tasks-main-view__remind-badge" aria-hidden>
          {count}
        </span>
      ) : null}
    </span>
  );
}

type TasksRemindIndicatorProps = {
  labels: TasksUILabels;
  alerts: Task["alerts"] | undefined;
};

/** Display-only row mark. Hidden when the task has no alarms. */
export function TasksRemindIndicator({ labels, alerts }: TasksRemindIndicatorProps) {
  const count = taskAlertCount(alerts);
  if (count === 0) return null;

  return (
    <span className="tasks-main-view__meta-item">
      <TasksRemindVisual
        count={count}
        className="tasks-main-view__remind--row"
        label={remindButtonLabel(labels, alerts)}
      >
        <Bell aria-hidden />
      </TasksRemindVisual>
    </span>
  );
}

type TasksRemindPickerProps = {
  labels: TasksUILabels;
  alerts: Task["alerts"] | undefined;
  onChange: (alerts: Task["alerts"] | undefined) => void;
  disabled?: boolean;
};

export function TasksRemindPicker({
  labels,
  alerts,
  onChange,
  disabled = false,
}: TasksRemindPickerProps) {
  const [open, setOpen] = useState(false);
  const formAlerts = taskAlertsToFormValues(alerts);
  const count = taskAlertCount(alerts);
  const buttonLabel = remindButtonLabel(labels, alerts);
  const alarmLabels = tasksAlarmRowLabels(labels);

  return (
    <>
      <TasksRemindVisual count={count} className="tasks-main-view__remind--composer">
        <IconButton
          label={buttonLabel}
          icon={<Bell aria-hidden />}
          size="md"
          variant="outline"
          active={count > 0}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="tasks-main-view__remind-button"
          onClick={() => setOpen(true)}
        />
      </TasksRemindVisual>
      <Dialog open={disabled ? false : open} onOpenChange={setOpen}>
        <DialogContent
          className="tasks-dialog-surface tasks-remind-dialog"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{labels.remindMe}</DialogTitle>
          </DialogHeader>
          <div className="share-access-card calendar-alarms-card tasks-remind-dialog__alarms">
            <CardPanel>
              <CalendarAlarmsRows
                alerts={formAlerts}
                labels={alarmLabels}
                disabled={disabled}
                defaultRelatedTo="end"
                onChange={(next) => onChange(formValuesToTaskAlerts(next))}
              />
            </CardPanel>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
