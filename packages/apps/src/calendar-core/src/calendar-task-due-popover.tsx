import { ListTodo } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  detailsPopoverAnchorOrigin,
  detailsPopoverShouldDock,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  formatTaskDueOverlayWhen,
  tasksListTaskHref,
  type TaskDueOverlayMarker,
} from "@/calendar-core/src/calendar-task-due-overlay";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import "./calendar-event-details-popover.css";
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
  const isMobile = useIsMobile();
  if (!marker) return null;

  const title = marker.title.trim() || labels.untitledTask;
  const when = formatTaskDueOverlayWhen(marker.due, marker.allDay, locale);
  const href = tasksListTaskHref(marker.taskListId, marker.taskId);
  const docked = !isMobile && detailsPopoverShouldDock(origin);
  const placementOrigin = origin && !docked ? detailsPopoverAnchorOrigin(origin) : origin;
  const fallbackLeft = Math.round(globalThis.innerWidth / 2);
  const fallbackTop = Math.round(globalThis.innerHeight * 0.28);
  const anchorStyle = docked
    ? { left: 0, top: 0, width: 0, height: 0 }
    : placementOrigin
      ? {
          left: placementOrigin.left,
          top: placementOrigin.top,
          width: placementOrigin.width,
          height: placementOrigin.height,
        }
      : { left: fallbackLeft, top: fallbackTop, width: 0, height: 0 };

  const body = (
    <div className="calendar-task-due-popover__body">
      <p className="calendar-task-due-popover__title">{title}</p>
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
            size="sm"
            onClick={() => onOpenInTasks(href)}
            icon={<ListTodo className="size-3.5" aria-hidden />}
          />
        </footer>
      ) : null}
    </div>
  );

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="calendar-dialog-surface calendar-event-details-popover calendar-event-details-popover--dialog calendar-task-due-popover">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => !next && onClose()}>
      <PopoverAnchor asChild>
        <span
          className={
            docked
              ? "calendar-event-details-popover__anchor calendar-event-details-popover__anchor--docked"
              : "calendar-event-details-popover__anchor"
          }
          style={anchorStyle}
          aria-hidden
        />
      </PopoverAnchor>
      <PopoverContent
        className={
          docked
            ? "calendar-dialog-surface calendar-event-details-popover calendar-event-details-popover--docked calendar-task-due-popover"
            : "calendar-dialog-surface calendar-event-details-popover calendar-task-due-popover"
        }
        side="right"
        align="center"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}
