import { useRef, useState } from "react";
import { CalendarDays, ChevronDown, Clock } from "lucide-react";
import { Button } from "@/button/src/button";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { Calendar } from "@/ui/calendar";
import { Input } from "@/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Switch } from "@/ui/switch";
import { CollectionGhostButton } from "@/ui/collection-ghost-select";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  applyDueTime,
  DEFAULT_TASK_DUE_TIME,
  dueDateTimeToApiValue,
  dueDateToApiValue,
  dueTimeInputValue,
  formatComposerDueDateLabel,
  parseDueDateValue,
  taskDueIsDateOnly,
  type TaskDueFields,
} from "@/tasks-core/src/tasks-task-utils";

type TasksDueFieldProps = {
  labels: TasksUILabels;
  due: string | null;
  showWithoutTime?: boolean;
  onChange: (next: TaskDueFields) => void;
  disabled?: boolean;
};

/*
 * Due times are floating (wall clock, no time zone) for now: every change sends
 * `timeZone: null`. See "Known limitations" in docs/architecture/tasks.md.
 */
const dateOnlyDue = (date: Date): TaskDueFields => ({
  due: dueDateToApiValue(date),
  showWithoutTime: true,
  timeZone: null,
});

const timedDue = (date: Date): TaskDueFields => ({
  due: dueDateTimeToApiValue(date),
  showWithoutTime: false,
  timeZone: null,
});

/**
 * The due field: the day as a ghost dropdown and, unless the task is all day, a
 * time field that takes any time (as the Calendar event editor). All day is its
 * own switch, {@link TasksDueAllDaySwitch}.
 */
export function TasksComposerDuePicker({
  labels,
  due,
  showWithoutTime = true,
  onChange,
  disabled,
}: TasksDueFieldProps) {
  const [open, setOpen] = useState(false);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const selectedDate = parseDueDateValue(due);
  const dateOnly = taskDueIsDateOnly(due, showWithoutTime);
  const dateLabel = selectedDate ? formatComposerDueDateLabel(selectedDate, labels) : labels.noDue;

  return (
    <span className="tasks-field__due">
      <Popover
        open={disabled ? false : open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <CollectionGhostButton
            className="tasks-field__ghost"
            // Field name + the visible value, so the name contains what is on screen (WCAG 2.5.3).
            aria-label={`${labels.addTaskDue}: ${dateLabel}`}
            disabled={disabled}
            leading={<CalendarDays className="size-3.5" aria-hidden />}
            label={dateLabel}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={16}
          className="tasks-field__due-popover w-auto p-0"
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              setOpen(false);
              if (!date) {
                onChange({ due: null, showWithoutTime: true, timeZone: null });
                return;
              }
              onChange(
                dateOnly || !selectedDate
                  ? dateOnlyDue(date)
                  : timedDue(applyDueTime(date, dueTimeInputValue(selectedDate))),
              );
            }}
            initialFocus
          />
          {selectedDate ? (
            <div className="tasks-field__due-clear">
              <Button
                type="button"
                variant="outline"
                size="md"
                className="tasks-field__due-clear-button"
                label={labels.noDue}
                onClick={() => {
                  onChange({ due: null, showWithoutTime: true, timeZone: null });
                  setOpen(false);
                }}
              />
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {selectedDate && !dateOnly ? (
        <label
          className="collection-ghost-select tasks-field__ghost tasks-field__time"
          // A click anywhere on the ghost opens the browser's time picker, as a dropdown.
          onClick={() => {
            if (disabled) return;
            try {
              timeInputRef.current?.showPicker();
            } catch {
              // No picker (or not allowed here): the field still takes typing.
            }
          }}
        >
          <Clock className="size-3.5" aria-hidden />
          <Input
            ref={timeInputRef}
            type="time"
            size="sm"
            lang={resolveLocale(undefined)}
            className="tasks-field__time-input"
            aria-label={labels.dueTimeLabel}
            value={dueTimeInputValue(selectedDate)}
            disabled={disabled}
            onChange={(event) => {
              // Clearing the field keeps the time; All day removes it.
              if (!event.target.value) return;
              onChange(timedDue(applyDueTime(selectedDate, event.target.value)));
            }}
          />
          {disabled ? null : (
            <ChevronDown className="collection-ghost-select__chevron" aria-hidden />
          )}
        </label>
      ) : null}
    </span>
  );
}

/** All day on: a date-only due. Off: the due gets a time (09:00 to start). */
export function TasksDueAllDaySwitch({
  labels,
  due,
  showWithoutTime = true,
  onChange,
  disabled,
}: TasksDueFieldProps) {
  const selectedDate = parseDueDateValue(due);
  if (!selectedDate) return null;
  const allDay = taskDueIsDateOnly(due, showWithoutTime);
  return (
    <Switch
      checked={allDay}
      aria-label={labels.dueAllDay}
      disabled={disabled}
      onCheckedChange={(checked) =>
        onChange(
          checked
            ? dateOnlyDue(selectedDate)
            : timedDue(applyDueTime(selectedDate, DEFAULT_TASK_DUE_TIME)),
        )
      }
    />
  );
}
