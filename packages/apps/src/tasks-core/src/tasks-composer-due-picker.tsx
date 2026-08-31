import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  defaultTimedEventTimeZone,
  eventTimeZoneFromSelectValue,
  eventTimeZoneOptions,
  eventTimeZoneSelectValue,
} from "@/calendar-core/src/calendar-timezones";
import { Button } from "@/button/src/button";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { Calendar } from "@/ui/calendar";
import { Input } from "@/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  applyDueTime,
  DEFAULT_TASK_DUE_TIME,
  dueDateTimeToApiValue,
  dueDateToApiValue,
  dueTimeInputValue,
  formatComposerDueLabel,
  parseDueDateValue,
  taskDueIsDateOnly,
  type TaskDueFields,
} from "@/tasks-core/src/tasks-task-utils";

type TasksComposerDuePickerProps = {
  labels: TasksUILabels;
  due: string | null;
  showWithoutTime?: boolean;
  timeZone?: string | null;
  onChange: (next: TaskDueFields) => void;
  disabled?: boolean;
  triggerClassName?: string;
};

export function TasksComposerDuePicker({
  labels,
  due,
  showWithoutTime = true,
  timeZone = null,
  onChange,
  disabled,
  triggerClassName,
}: TasksComposerDuePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseDueDateValue(due);
  const dateOnly = taskDueIsDateOnly(due, showWithoutTime);
  const displayLabel = formatComposerDueLabel(due, showWithoutTime, labels) ?? labels.noDue;
  const locale = resolveLocale(undefined);
  const timeZoneOptions = useMemo(
    () => eventTimeZoneOptions(locale, defaultCalendarLabels.eventTimeZoneLocalLabel, timeZone),
    [locale, timeZone],
  );

  const emitDateOnly = (date: Date): void => {
    onChange({
      due: dueDateToApiValue(date),
      showWithoutTime: true,
      timeZone: null,
    });
  };

  const emitTimed = (date: Date, nextTimeZone: string | null): void => {
    onChange({
      due: dueDateTimeToApiValue(date),
      showWithoutTime: false,
      timeZone: nextTimeZone,
    });
  };

  return (
    <Popover
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          aria-label={labels.addTaskDue}
          disabled={disabled}
        >
          <span className="tasks-main-view__composer-select-option">
            <CalendarDays className="size-3.5" aria-hidden />
            <span>{displayLabel}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="tasks-main-view__composer-due-popover w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            if (!date) {
              onChange({ due: null, showWithoutTime: true, timeZone: null });
              return;
            }
            if (dateOnly || !selectedDate) {
              emitDateOnly(date);
              return;
            }
            emitTimed(
              new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate(),
                selectedDate.getHours(),
                selectedDate.getMinutes(),
                selectedDate.getSeconds(),
              ),
              timeZone,
            );
          }}
          initialFocus
        />
        {selectedDate ? (
          <div className="tasks-main-view__composer-due-extras">
            {dateOnly ? (
              <Button
                type="button"
                variant="subtle"
                size="sm"
                label={labels.dueAddTime}
                onClick={() =>
                  emitTimed(
                    applyDueTime(selectedDate, DEFAULT_TASK_DUE_TIME),
                    defaultTimedEventTimeZone(),
                  )
                }
              />
            ) : (
              <div className="tasks-main-view__composer-due-time-row">
                <Input
                  type="time"
                  size="sm"
                  className="tasks-main-view__composer-due-time"
                  value={dueTimeInputValue(selectedDate)}
                  aria-label={labels.dueTimeLabel}
                  onChange={(event) =>
                    emitTimed(applyDueTime(selectedDate, event.target.value), timeZone)
                  }
                />
                <Select
                  value={eventTimeZoneSelectValue(timeZone)}
                  onValueChange={(value) =>
                    emitTimed(selectedDate, eventTimeZoneFromSelectValue(value))
                  }
                >
                  <SelectTrigger
                    className="tasks-main-view__composer-due-timezone"
                    aria-label={defaultCalendarLabels.eventTimeZoneLabel}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timeZoneOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  label={labels.dueDateOnly}
                  onClick={() => emitDateOnly(selectedDate)}
                />
              </div>
            )}
          </div>
        ) : null}
        {selectedDate ? (
          <div className="tasks-main-view__composer-due-clear">
            <Button
              type="button"
              variant="subtle"
              size="sm"
              className="tasks-main-view__composer-due-clear-button"
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
  );
}
