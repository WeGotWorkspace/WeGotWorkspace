import { Bell } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  alertsAfterOffsetChange,
  formatUnmatchedAlertOffset,
  isAlertOffsetSelectValue,
  matchAlertOffsetPreset,
  type CalendarAlertOffsetSelectValue,
  type CalendarEventAlertFormValue,
} from "@/calendar-core/src/calendar-alerts";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import "@/share-ui/share-ui.css";
import "@/calendar-core/src/calendar-alarms-card.css";

const EMPTY_SLOT_ID = null;

function foreignSelectValue(alert: CalendarEventAlertFormValue): string | null {
  if (alert.offset != null) {
    return matchAlertOffsetPreset(alert.offset) ? null : `offset:${alert.offset}`;
  }
  if (alert.when) return `when:${alert.when}`;
  return null;
}

function alarmOffsetSelectValue(alert: CalendarEventAlertFormValue | null): string {
  if (!alert) return "none";
  if (alert.offset != null) {
    return matchAlertOffsetPreset(alert.offset) ?? `offset:${alert.offset}`;
  }
  if (alert.when) return `when:${alert.when}`;
  return "none";
}

function foreignSelectLabel(alert: CalendarEventAlertFormValue): string {
  if (alert.offset != null) return formatUnmatchedAlertOffset(alert.offset);
  return alert.when ?? "";
}

function AlarmOffsetControls({
  alert,
  labels,
  disabled,
  onSelect,
}: {
  alert: CalendarEventAlertFormValue | null;
  labels: CalendarAlarmsCardLabels;
  disabled: boolean;
  onSelect: (value: CalendarAlertOffsetSelectValue) => void;
}) {
  const selectValue = alarmOffsetSelectValue(alert);
  const foreignValue = alert ? foreignSelectValue(alert) : null;

  return (
    <div className="calendar-event-dialog__alarm-row">
      <Select
        value={selectValue}
        onValueChange={(value) => {
          if (isAlertOffsetSelectValue(value)) onSelect(value);
        }}
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
          {foreignValue && alert ? (
            <SelectItem value={foreignValue} disabled>
              {foreignSelectLabel(alert)}
            </SelectItem>
          ) : null}
          <SelectItem value="at-start">{labels.eventAlarmAtStart}</SelectItem>
          <SelectItem value="5m">{labels.eventAlarm5Min}</SelectItem>
          <SelectItem value="10m">{labels.eventAlarm10Min}</SelectItem>
          <SelectItem value="15m">{labels.eventAlarm15Min}</SelectItem>
          <SelectItem value="30m">{labels.eventAlarm30Min}</SelectItem>
          <SelectItem value="1h">{labels.eventAlarm1Hour}</SelectItem>
          <SelectItem value="1d">{labels.eventAlarm1Day}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export type CalendarAlarmsCardLabels = Pick<
  CalendarUILabels,
  | "eventAlarmsLabel"
  | "eventAlarmRow"
  | "eventAlarmRemove"
  | "eventAlarmOffset"
  | "eventAlarmNone"
  | "eventAlarmAtStart"
  | "eventAlarm5Min"
  | "eventAlarm10Min"
  | "eventAlarm15Min"
  | "eventAlarm30Min"
  | "eventAlarm1Hour"
  | "eventAlarm1Day"
>;

export type CalendarAlarmsCardProps = {
  alerts: CalendarEventAlertFormValue[];
  labels: CalendarAlarmsCardLabels;
  disabled?: boolean;
  readOnly?: boolean;
  /** Tasks persist due-relative offsets; calendar leaves this unset (event start). */
  defaultRelatedTo?: "start" | "end";
  onChange: (alerts: CalendarEventAlertFormValue[]) => void;
};

export function CalendarAlarmsRows({
  alerts,
  labels,
  disabled = false,
  readOnly = false,
  defaultRelatedTo,
  onChange,
}: CalendarAlarmsCardProps) {
  const showTrailingNone = !readOnly;
  const commitOffset = (rowId: string | null, value: CalendarAlertOffsetSelectValue) => {
    onChange(alertsAfterOffsetChange({ alerts, rowId, value, defaultRelatedTo }));
  };

  return (
    <>
      {alerts.map((alert, index) => (
        <ShareAccessRow
          key={alert.id}
          title={`${labels.eventAlarmRow} ${index + 1}`}
          trailing={
            <AlarmOffsetControls
              alert={alert}
              labels={labels}
              disabled={disabled || readOnly}
              onSelect={(value) => commitOffset(alert.id, value)}
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
          title={`${labels.eventAlarmRow} ${alerts.length + 1}`}
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
    </>
  );
}

export function CalendarAlarmsCard(props: CalendarAlarmsCardProps) {
  return (
    <ShareAccessCard
      className="calendar-event-dialog__card calendar-alarms-card"
      titleIcon={<Bell />}
      title={props.labels.eventAlarmsLabel}
    >
      <CalendarAlarmsRows {...props} />
    </ShareAccessCard>
  );
}
