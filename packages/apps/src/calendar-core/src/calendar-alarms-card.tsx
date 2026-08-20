import { Bell } from "lucide-react";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  alertsAfterOffsetChange,
  formatCustomOffset,
  matchAlertOffsetPreset,
  parseCustomOffset,
  type CalendarAlertCustomUnit,
  type CalendarAlertOffsetSelectValue,
  type CalendarEventAlertFormValue,
} from "@/calendar-core/src/calendar-alerts";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import "@/share-ui/share-ui.css";

const EMPTY_SLOT_ID = null;

function alarmOffsetSelectValue(
  alert: CalendarEventAlertFormValue | null,
): CalendarAlertOffsetSelectValue {
  if (!alert) return "none";
  if (alert.offset == null) return "custom";
  return matchAlertOffsetPreset(alert.offset);
}

function AlarmOffsetControls({
  alert,
  labels,
  disabled,
  onSelect,
  onPatch,
}: {
  alert: CalendarEventAlertFormValue | null;
  labels: CalendarUILabels;
  disabled: boolean;
  onSelect: (value: CalendarAlertOffsetSelectValue) => void;
  onPatch?: (patch: Partial<CalendarEventAlertFormValue>) => void;
}) {
  const preset = alarmOffsetSelectValue(alert);
  const custom = alert?.offset
    ? parseCustomOffset(alert.offset)
    : { amount: 15, unit: "minutes" as const };
  const isAbsolute = Boolean(alert && alert.offset == null && alert.when);

  return (
    <div className="calendar-event-dialog__alarm-row">
      <Select
        value={isAbsolute ? "custom" : preset}
        onValueChange={(value) => onSelect(value as CalendarAlertOffsetSelectValue)}
        disabled={disabled}
      >
        <SelectTrigger
          className="calendar-event-dialog__alarm-offset"
          aria-label={labels.eventAlarmOffset}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{labels.eventAlarmNone}</SelectItem>
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
      {isAbsolute && alert && onPatch ? (
        <Input
          type="datetime-local"
          className="calendar-event-dialog__alarm-when"
          value={alert.when?.slice(0, 16) ?? ""}
          aria-label={labels.eventAlarmCustom}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            onPatch({ offset: null, when: `${value}:00` });
          }}
        />
      ) : null}
      {preset === "custom" && !isAbsolute && alert && onPatch ? (
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
              onPatch({
                offset: formatCustomOffset(Number.isFinite(parsed) ? parsed : 1, custom.unit),
                when: undefined,
              });
            }}
          />
          <Select
            value={custom.unit}
            onValueChange={(value) =>
              onPatch({
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
  const showTrailingNone = !readOnly;
  const commitOffset = (rowId: string | null, value: CalendarAlertOffsetSelectValue) => {
    onChange(alertsAfterOffsetChange({ alerts, rowId, value }));
  };

  return (
    <ShareAccessCard
      className="calendar-event-dialog__card"
      titleIcon={<Bell className="size-4" />}
      title={labels.eventAlarmsLabel}
    >
      {alerts.map((alert) => (
        <ShareAccessRow
          key={alert.id}
          title={labels.eventAlarmRow}
          trailing={
            <AlarmOffsetControls
              alert={alert}
              labels={labels}
              disabled={disabled || readOnly}
              onSelect={(value) => commitOffset(alert.id, value)}
              onPatch={(patch) =>
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
      {showTrailingNone ? (
        <ShareAccessRow
          title={labels.eventAlarmRow}
          trailing={
            <AlarmOffsetControls
              alert={null}
              labels={labels}
              disabled={disabled}
              onSelect={(value) => commitOffset(EMPTY_SLOT_ID, value)}
            />
          }
        />
      ) : null}
    </ShareAccessCard>
  );
}
