import { Bell } from "lucide-react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  defaultEventAlert,
  formatCustomOffset,
  matchAlertOffsetPreset,
  parseCustomOffset,
  presetToOffset,
  type CalendarAlertCustomUnit,
  type CalendarAlertOffsetPreset,
  type CalendarEventAlertFormValue,
} from "@/calendar-core/src/calendar-alerts";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import "@/share-ui/share-ui.css";

function alarmOffsetSelectValue(alert: CalendarEventAlertFormValue): CalendarAlertOffsetPreset {
  if (alert.offset == null) return "custom";
  return matchAlertOffsetPreset(alert.offset);
}

function AlarmOffsetControls({
  alert,
  labels,
  disabled,
  onChange,
}: {
  alert: CalendarEventAlertFormValue;
  labels: CalendarUILabels;
  disabled: boolean;
  onChange: (patch: Partial<CalendarEventAlertFormValue>) => void;
}) {
  const preset = alarmOffsetSelectValue(alert);
  const custom = alert.offset
    ? parseCustomOffset(alert.offset)
    : { amount: 15, unit: "minutes" as const };
  const isAbsolute = alert.offset == null && Boolean(alert.when);

  return (
    <div className="calendar-event-dialog__alarm-row">
      <Select
        value={isAbsolute ? "custom" : preset}
        onValueChange={(value) => {
          const next = value as CalendarAlertOffsetPreset;
          if (next === "custom") {
            onChange({
              offset: alert.offset ?? "-PT15M",
              when: undefined,
            });
            return;
          }
          onChange({ offset: presetToOffset(next), when: undefined });
        }}
        disabled={disabled}
      >
        <SelectTrigger
          className="calendar-event-dialog__alarm-offset"
          aria-label={labels.eventAlarmsLabel}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="at-start">{labels.eventAlarmAtStart}</SelectItem>
          <SelectItem value="5m">{labels.eventAlarm5Min}</SelectItem>
          <SelectItem value="10m">{labels.eventAlarm10Min}</SelectItem>
          <SelectItem value="15m">{labels.eventAlarm15Min}</SelectItem>
          <SelectItem value="30m">{labels.eventAlarm30Min}</SelectItem>
          <SelectItem value="1h">{labels.eventAlarm1Hour}</SelectItem>
          <SelectItem value="1d">{labels.eventAlarm1Day}</SelectItem>
          <SelectItem value="custom">{labels.eventAlarmCustom}</SelectItem>
        </SelectContent>
      </Select>
      {isAbsolute ? (
        <Input
          type="datetime-local"
          className="calendar-event-dialog__alarm-when"
          value={alert.when?.slice(0, 16) ?? ""}
          aria-label={labels.eventAlarmCustom}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            onChange({ offset: null, when: `${value}:00` });
          }}
        />
      ) : null}
      {preset === "custom" && !isAbsolute ? (
        <div className="calendar-event-dialog__alarm-custom">
          <Input
            type="number"
            min={1}
            step={1}
            value={custom.amount}
            aria-label={labels.eventAlarmCustomAmount}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({
                offset: formatCustomOffset(Number.isFinite(parsed) ? parsed : 1, custom.unit),
                when: undefined,
              });
            }}
          />
          <Select
            value={custom.unit}
            onValueChange={(value) =>
              onChange({
                offset: formatCustomOffset(custom.amount, value as CalendarAlertCustomUnit),
                when: undefined,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger aria-label={labels.eventAlarmCustomAmount}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">{labels.eventAlarmUnitMinutes}</SelectItem>
              <SelectItem value="hours">{labels.eventAlarmUnitHours}</SelectItem>
              <SelectItem value="days">{labels.eventAlarmUnitDays}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

export type CalendarAlarmsCardProps = {
  alerts: CalendarEventAlertFormValue[];
  labels: CalendarUILabels;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (alerts: CalendarEventAlertFormValue[]) => void;
};

export function CalendarAlarmsCard({
  alerts,
  labels,
  disabled = false,
  readOnly = false,
  onChange,
}: CalendarAlarmsCardProps) {
  return (
    <ShareAccessCard
      className="calendar-event-dialog__card"
      titleIcon={<Bell className="size-4" />}
      title={labels.eventAlarmsLabel}
      description={alerts.length === 0 ? labels.eventAlarmsNone : undefined}
      addControl={
        readOnly ? undefined : (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange([...alerts, defaultEventAlert(alerts)])}
          >
            {labels.eventAlarmAdd}
          </Button>
        )
      }
    >
      {alerts.map((alert) => (
        <ShareAccessRow
          key={alert.id}
          mark={
            <div className="share-dialog__group-mark share-dialog__group-mark--active" aria-hidden>
              <Bell className="size-3.5" />
            </div>
          }
          title={labels.eventAlarmsLabel}
          trailing={
            <AlarmOffsetControls
              alert={alert}
              labels={labels}
              disabled={disabled || readOnly}
              onChange={(patch) =>
                onChange(alerts.map((row) => (row.id === alert.id ? { ...row, ...patch } : row)))
              }
            />
          }
          removeLabel={labels.eventAlarmRemove}
          removeDisabled={disabled}
          onRemove={
            readOnly ? undefined : () => onChange(alerts.filter((row) => row.id !== alert.id))
          }
        />
      ))}
    </ShareAccessCard>
  );
}
