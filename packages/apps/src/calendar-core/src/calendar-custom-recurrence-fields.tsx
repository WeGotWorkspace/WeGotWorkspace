import type { JSCalendarRecurrenceRule } from "@/lib/jmap-client/jscalendar/types";
import { CardRow } from "@/card/src/card-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  CUSTOM_RECURRENCE_WEEKDAYS,
  customRecurrenceFrequencyOptions,
  customRecurrenceInterval,
  customRecurrenceShowsByDay,
  patchCustomRecurrenceRule,
  toggleCustomRecurrenceDay,
  weekdayShortLabel,
} from "@/calendar-core/src/calendar-custom-recurrence";
import "./calendar-custom-recurrence-fields.css";

export type CalendarCustomRecurrenceFieldsProps = {
  rule: JSCalendarRecurrenceRule;
  startDateISO: string;
  labels: CalendarUILabels;
  locale: string;
  disabled?: boolean;
  onChange: (rule: JSCalendarRecurrenceRule) => void;
};

function frequencyLabel(
  frequency: JSCalendarRecurrenceRule["frequency"],
  labels: CalendarUILabels,
): string {
  switch (frequency) {
    case "daily":
      return labels.eventRecurrenceFrequencyDaily;
    case "weekly":
      return labels.eventRecurrenceFrequencyWeekly;
    case "monthly":
      return labels.eventRecurrenceFrequencyMonthly;
    case "yearly":
      return labels.eventRecurrenceFrequencyYearly;
    default:
      return frequency.charAt(0).toUpperCase() + frequency.slice(1);
  }
}

function intervalUnitLabel(
  frequency: JSCalendarRecurrenceRule["frequency"],
  labels: CalendarUILabels,
): string {
  switch (frequency) {
    case "weekly":
      return labels.eventRecurrenceIntervalWeeks;
    case "monthly":
      return labels.eventRecurrenceIntervalMonths;
    case "yearly":
      return labels.eventRecurrenceIntervalYears;
    default:
      return labels.eventRecurrenceIntervalDays;
  }
}

export function CalendarCustomRecurrenceFields({
  rule,
  startDateISO,
  labels,
  locale,
  disabled = false,
  onChange,
}: CalendarCustomRecurrenceFieldsProps) {
  const interval = customRecurrenceInterval(rule);

  return (
    <div className="calendar-event-dialog__custom-recurrence">
      <CardRow title={labels.eventRecurrenceFrequencyLabel}>
        <Select
          value={rule.frequency}
          onValueChange={(value) =>
            onChange(
              patchCustomRecurrenceRule(
                rule,
                { frequency: value as JSCalendarRecurrenceRule["frequency"] },
                startDateISO,
              ),
            )
          }
          disabled={disabled}
        >
          <SelectTrigger aria-label={labels.eventRecurrenceFrequencyLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {customRecurrenceFrequencyOptions(rule.frequency).map((frequency) => (
              <SelectItem key={frequency} value={frequency}>
                {frequencyLabel(frequency, labels)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardRow>
      <CardRow title={labels.eventRecurrenceIntervalLabel}>
        <div className="calendar-event-dialog__recurrence-interval">
          <Input
            className="calendar-event-dialog__recurrence-interval-input"
            type="number"
            min={1}
            step={1}
            value={interval}
            aria-label={labels.eventRecurrenceIntervalLabel}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange(
                patchCustomRecurrenceRule(
                  rule,
                  { interval: Number.isFinite(parsed) ? parsed : 1 },
                  startDateISO,
                ),
              );
            }}
          />
          <span className="calendar-event-dialog__recurrence-interval-suffix">
            {intervalUnitLabel(rule.frequency, labels)}
          </span>
        </div>
      </CardRow>
      {customRecurrenceShowsByDay(rule) ? (
        <CardRow title={labels.eventRecurrenceByDayLabel}>
          <div className="calendar-event-dialog__recurrence-by-day" role="group">
            {CUSTOM_RECURRENCE_WEEKDAYS.map((day) => {
              const pressed = Boolean(rule.byDay?.some((entry) => entry.day === day));
              const label = weekdayShortLabel(day, locale);
              return (
                <button
                  key={day}
                  type="button"
                  className="calendar-event-dialog__recurrence-day"
                  aria-pressed={pressed}
                  aria-label={label}
                  disabled={disabled}
                  onClick={() => onChange(toggleCustomRecurrenceDay(rule, day))}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </CardRow>
      ) : null}
    </div>
  );
}
