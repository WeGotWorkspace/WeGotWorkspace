import { Bell, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
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
import type { ControlSize } from "@/ui/control-size";
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

function AlarmOffsetRow({
  alert,
  labels,
  disabled,
  controlSize = "md",
  onSelect,
  onRemove,
}: {
  alert: CalendarEventAlertFormValue | null;
  labels: CalendarAlarmsCardLabels;
  disabled: boolean;
  controlSize?: ControlSize;
  onSelect: (value: CalendarAlertOffsetSelectValue) => void;
  onRemove?: () => void;
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
          size={controlSize}
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
      {onRemove ? (
        <IconButton
          label={labels.eventAlarmRemove}
          icon={<Trash2 className="size-3.5" aria-hidden />}
          size={controlSize}
          variant="outline"
          disabled={disabled}
          onClick={onRemove}
        />
      ) : null}
    </div>
  );
}

export type CalendarAlarmsCardLabels = Pick<
  CalendarUILabels,
  | "eventAlarmsLabel"
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
  /** Shared control height (`sm` in the compact event popover). Default `md`. */
  controlSize?: ControlSize;
  onChange: (alerts: CalendarEventAlertFormValue[]) => void;
};

export function CalendarAlarmsRows({
  alerts,
  labels,
  disabled = false,
  readOnly = false,
  defaultRelatedTo,
  controlSize = "md",
  onChange,
}: CalendarAlarmsCardProps) {
  const showTrailingNone = !readOnly;
  const commitOffset = (rowId: string | null, value: CalendarAlertOffsetSelectValue) => {
    onChange(alertsAfterOffsetChange({ alerts, rowId, value, defaultRelatedTo }));
  };

  return (
    <>
      {alerts.map((alert) => (
        <AlarmOffsetRow
          key={alert.id}
          alert={alert}
          labels={labels}
          disabled={disabled || readOnly}
          controlSize={controlSize}
          onSelect={(value) => commitOffset(alert.id, value)}
          onRemove={
            readOnly ? undefined : () => onChange(alerts.filter((row) => row.id !== alert.id))
          }
        />
      ))}
      {showTrailingNone ? (
        <AlarmOffsetRow
          alert={null}
          labels={labels}
          disabled={disabled}
          controlSize={controlSize}
          onSelect={(value) => commitOffset(EMPTY_SLOT_ID, value)}
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
