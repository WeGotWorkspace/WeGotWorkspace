import type { JSCalendarRecurrenceRule } from "@/lib/jmap-client/jscalendar/types";
import { CardRow } from "@/card/src/card-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  CUSTOM_RECURRENCE_DAY_KINDS,
  CUSTOM_RECURRENCE_MONTH_DAYS,
  CUSTOM_RECURRENCE_MONTHS,
  CUSTOM_RECURRENCE_ORDINALS,
  CUSTOM_RECURRENCE_WEEKDAYS,
  customRecurrenceDayKind,
  customRecurrenceFrequencyOptions,
  customRecurrenceInterval,
  customRecurrenceOrdinal,
  customRecurrenceRepeatMode,
  monthLongLabel,
  monthShortLabel,
  patchCustomRecurrenceOrdinal,
  patchCustomRecurrenceRule,
  setCustomRecurrenceRepeatMode,
  toggleCustomRecurrenceDay,
  toggleCustomRecurrenceMonth,
  toggleCustomRecurrenceMonthDay,
  weekdayShortLabel,
  type CustomRecurrenceDayKind,
  type CustomRecurrenceOrdinal,
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

function ordinalLabel(nth: CustomRecurrenceOrdinal, labels: CalendarUILabels): string {
  switch (nth) {
    case 1:
      return labels.eventRecurrenceOrdinal1;
    case 2:
      return labels.eventRecurrenceOrdinal2;
    case 3:
      return labels.eventRecurrenceOrdinal3;
    case 4:
      return labels.eventRecurrenceOrdinal4;
    case 5:
      return labels.eventRecurrenceOrdinal5;
    case -1:
      return labels.eventRecurrenceOrdinalLast;
  }
}

function dayKindLabel(
  kind: CustomRecurrenceDayKind,
  labels: CalendarUILabels,
  locale: string,
): string {
  if (kind === "day") return labels.eventRecurrenceDayKindDay;
  if (kind === "weekday") return labels.eventRecurrenceDayKindWeekday;
  if (kind === "weekend") return labels.eventRecurrenceDayKindWeekend;
  return weekdayShortLabel(kind, locale);
}

function RecurrenceChip({
  pressed,
  label,
  ariaLabel,
  disabled,
  onClick,
}: {
  pressed: boolean;
  label: string;
  ariaLabel?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="calendar-event-dialog__recurrence-day"
      aria-pressed={pressed}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function RepeatOnFields({
  rule,
  startDateISO,
  labels,
  locale,
  disabled,
  onChange,
}: {
  rule: JSCalendarRecurrenceRule;
  startDateISO: string;
  labels: CalendarUILabels;
  locale: string;
  disabled: boolean;
  onChange: (rule: JSCalendarRecurrenceRule) => void;
}) {
  const mode = customRecurrenceRepeatMode(rule);
  if (mode === "none") return null;

  if (mode === "by-day") {
    return (
      <CardRow title={labels.eventRecurrenceByDayLabel}>
        <div className="calendar-event-dialog__recurrence-by-day" role="group">
          {CUSTOM_RECURRENCE_WEEKDAYS.map((day) => {
            const label = weekdayShortLabel(day, locale);
            return (
              <RecurrenceChip
                key={day}
                pressed={Boolean(rule.byDay?.some((entry) => entry.day === day))}
                label={label}
                disabled={disabled}
                onClick={() => onChange(toggleCustomRecurrenceDay(rule, day))}
              />
            );
          })}
        </div>
      </CardRow>
    );
  }

  const gridMode = rule.frequency === "yearly" ? "year-months" : "month-days";

  return (
    <CardRow title={labels.eventRecurrenceByDayLabel} fill>
      <div className="calendar-event-dialog__recurrence-repeat">
        <Select
          value={mode === "ordinal" ? "ordinal" : gridMode}
          onValueChange={(value) =>
            onChange(
              setCustomRecurrenceRepeatMode(
                rule,
                value as "month-days" | "year-months" | "ordinal",
                startDateISO,
              ),
            )
          }
          disabled={disabled}
        >
          <SelectTrigger aria-label={labels.eventRecurrenceByDayLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={gridMode}>
              {rule.frequency === "yearly"
                ? labels.eventRecurrenceOnMonths
                : labels.eventRecurrenceOnMonthDays}
            </SelectItem>
            <SelectItem value="ordinal">{labels.eventRecurrenceOnThe}</SelectItem>
          </SelectContent>
        </Select>
        {mode === "month-days" ? (
          <div className="calendar-event-dialog__recurrence-month-days" role="group">
            {CUSTOM_RECURRENCE_MONTH_DAYS.map((day) => (
              <RecurrenceChip
                key={day}
                pressed={Boolean(rule.byMonthDay?.includes(day))}
                label={String(day)}
                disabled={disabled}
                onClick={() => onChange(toggleCustomRecurrenceMonthDay(rule, day))}
              />
            ))}
          </div>
        ) : null}
        {mode === "year-months" ? (
          <div className="calendar-event-dialog__recurrence-year-months" role="group">
            {CUSTOM_RECURRENCE_MONTHS.map((month) => (
              <RecurrenceChip
                key={month}
                pressed={Boolean(rule.byMonth?.includes(String(month)))}
                label={monthShortLabel(month, locale)}
                ariaLabel={monthLongLabel(month, locale)}
                disabled={disabled}
                onClick={() => onChange(toggleCustomRecurrenceMonth(rule, month))}
              />
            ))}
          </div>
        ) : null}
        {mode === "ordinal" ? (
          <div className="calendar-event-dialog__recurrence-ordinal">
            <Select
              value={String(customRecurrenceOrdinal(rule))}
              onValueChange={(value) =>
                onChange(
                  patchCustomRecurrenceOrdinal(
                    rule,
                    { nth: Number.parseInt(value, 10) as CustomRecurrenceOrdinal },
                    startDateISO,
                  ),
                )
              }
              disabled={disabled}
            >
              <SelectTrigger aria-label={labels.eventRecurrenceOrdinalLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_RECURRENCE_ORDINALS.map((nth) => (
                  <SelectItem key={nth} value={String(nth)}>
                    {ordinalLabel(nth, labels)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={customRecurrenceDayKind(rule)}
              onValueChange={(value) =>
                onChange(
                  patchCustomRecurrenceOrdinal(
                    rule,
                    { kind: value as CustomRecurrenceDayKind },
                    startDateISO,
                  ),
                )
              }
              disabled={disabled}
            >
              <SelectTrigger aria-label={labels.eventRecurrenceDayKindLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_RECURRENCE_DAY_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {dayKindLabel(kind, labels, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </CardRow>
  );
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
      <RepeatOnFields
        rule={rule}
        startDateISO={startDateISO}
        labels={labels}
        locale={locale}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
