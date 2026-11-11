import { ListTodo } from "lucide-react";
import { Button } from "@/button/src/button";
import type { CalendarEventSelectionOrigin } from "@/calendar-core/src/calendar-event-preview";
import { CalendarOverlayPopoverShell } from "@/calendar-core/src/calendar-overlay-popover-shell";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  formatTaskDueOverlayWhen,
  tasksListTaskHref,
  type TaskDueOverlayMarker,
} from "@/calendar-core/src/calendar-task-due-overlay";
import "./calendar-task-due-popover.css";

export type CalendarTaskDuePopoverProps = {
  open: boolean;
  marker: TaskDueOverlayMarker | null;
  labels: CalendarUILabels;
  locale: string;
  origin?: CalendarEventSelectionOrigin;
  onClose: () => void;
  onOpenInTasks?: (href: string) => void;
};

export function CalendarTaskDuePopover({
  open,
  marker,
  labels,
  locale,
  origin,
  onClose,
  onOpenInTasks,
}: CalendarTaskDuePopoverProps) {
  if (!marker) return null;

  const title = marker.title.trim() || labels.untitledTask;
  const when = formatTaskDueOverlayWhen(marker.due, marker.allDay, locale);
  const href = tasksListTaskHref(marker.taskListId, marker.taskId);

  const details = (
    <>
      <p className="calendar-task-due-popover__when">{when}</p>
      <p className="calendar-task-due-popover__list">
        <span
          className="calendar-task-due-popover__dot"
          style={{ background: marker.listColor }}
          aria-hidden
        />
        <span>
          <span className="sr-only">{labels.taskDueListLabel}. </span>
          {marker.listName}
        </span>
      </p>
      {onOpenInTasks ? (
        <footer className="calendar-task-due-popover__footer">
          <Button
            label={labels.taskDueOpenInTasks}
            variant="outline"
            size="sm"
            onClick={() => onOpenInTasks(href)}
            icon={<ListTodo className="size-3.5" aria-hidden />}
          />
        </footer>
      ) : null}
    </>
  );

  return (
    <CalendarOverlayPopoverShell
      open={open}
      locale={locale}
      origin={origin}
      title={title}
      ariaLabel={title}
      className="calendar-task-due-popover"
      bodyClassName="calendar-task-due-popover__body"
      titleClassName="calendar-task-due-popover__title"
      onClose={onClose}
    >
      {details}
    </CalendarOverlayPopoverShell>
  );
}
